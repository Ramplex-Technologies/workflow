/* --------------------------------------------------------------------------

  MIT License

  Copyright (c) 2025 Rami Pellumbi

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
-----------------------------------------------------------------------------*/

import { Context } from "./_context";
import { DependencyMap } from "./_dependency-map";
import { Node, type NodeCompletionEvent, type NodeOptions } from "./_node";
import { NodeError } from "./error";

type DeepReadonly<T> = {
    readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/**
 * Represents a workflow which nodes can be added to
 * When built, the graph will be sorted topologically and returned as a `WorkflowRunner` instance.
 *
 * @template TInitialNodeContext - Type of the context in the `initial` key that each node will receive
 * @template TNodeContext - Type of the context each node will receive
 * @template TAllDependencyIds - The node IDs that can be used as dependencies for new nodes
 */
export class Workflow<
    TInitialNodeContext = undefined,
    TNodeContext extends Record<string, unknown> = {
        readonly initial: DeepReadonly<TInitialNodeContext>;
    },
    TAllDependencyIds extends string = never,
> {
    readonly #contextValueOrFactory:
        | TInitialNodeContext
        | (() => DeepReadonly<TInitialNodeContext> | Promise<DeepReadonly<TInitialNodeContext>>)
        | undefined = undefined;
    readonly #nodes = new Map<
        string,
        Node<TNodeContext & { readonly initial: DeepReadonly<TInitialNodeContext> }, unknown, string>
    >();
    readonly #nodeDependencies = new DependencyMap();
    readonly #topologicalOrder: string[] = [];

    constructor(
        options?:
            | {
                  contextValue?: TInitialNodeContext;
              }
            | {
                  contextFactory: () => TInitialNodeContext | Promise<TInitialNodeContext>;
              },
    ) {
        // Early return if no options provided
        if (!options) {
            return;
        }

        // Validate only one of the context options
        if ("contextValue" in options && "contextFactory" in options) {
            throw new Error("Cannot specify both contextValue and contextFactory");
        }

        if ("contextValue" in options) {
            if (options.contextValue !== undefined) {
                if (typeof options.contextValue === "function") {
                    throw new Error("Context value must not be a function");
                }
                this.#contextValueOrFactory = options.contextValue;
            }
        } else if ("contextFactory" in options) {
            if (typeof options.contextFactory !== "function") {
                throw new Error("Context factory must be a function that returns a value or Promise");
            }
            this.#contextValueOrFactory = options.contextFactory;
        }
    }

    /**
     * Adds a new node to the workflow.
     *
     * @template TNodeId The ID of the node, which must be unique.
     * @template TNodeDependencyIds The IDs of the node's dependencies.
     * @template TNodeReturn The return type of the node.
     * @param options The configuration options for the node:
     * @param options.id A unique identifier for the node.
     * @param options.execute A function that performs the node's operation. It receives an object with the `ctx` (context) property.
     * @param options.dependencies An optional array of node IDs that this node depends on. If not provided, the node will be executed immediately on start.
     * @param options.retryPolicy An optional retry policy for the node, specifying maxRetries and retryDelayMs. Defaults to no retries.
     * @param options.errorHandler An optional function to handle errors that occur during node execution. Defaults to `console.error`.
     *
     * @returns The instance of `Workflow` with the new node added for chaining.
     *
     * @throws {Error} If a node with the same ID already exists.
     * @throws {Error} If a specified dependency node has not been added to the workflow yet.
     */
    addNode<TNodeId extends string, TNodeReturn, TNodeDependencyIds extends TAllDependencyIds = never>(
        options: NodeOptions<
            TNodeId,
            TNodeContext & { readonly initial: DeepReadonly<TInitialNodeContext> },
            TNodeReturn,
            TNodeDependencyIds
        >,
    ): Workflow<
        TInitialNodeContext,
        TNodeContext & { readonly [K in TNodeId]?: TNodeReturn },
        TAllDependencyIds | TNodeId
    > {
        const nodeId = options.id;
        if (options.id === "initial") {
            throw new Error(`Node with id '${options.id}' cannot be created. 'initial' is a reserved keyword.`);
        }
        if (this.#nodes.has(nodeId)) {
            throw new Error(`Node with id ${nodeId} already exists`);
        }

        const node = new Node(options);
        for (const depId of options.dependencies ?? []) {
            if (typeof depId !== "string") {
                throw new Error("Dependency ID must be a string");
            }
            if ((depId as string) === nodeId) {
                throw new Error(`Node ${nodeId} cannot depend on itself`);
            }
            const dependentNode = this.#nodes.get(depId);
            if (!dependentNode) {
                throw new Error(`Dependency ${depId} not found for node ${nodeId}`);
            }
            this.#nodeDependencies.add(nodeId, depId);
        }

        // biome-ignore lint/suspicious/noExplicitAny: the typing here is super annoying
        this.#nodes.set(nodeId, node as any);
        // biome-ignore lint/suspicious/noExplicitAny: do not want to track the type in two places
        return this as any;
    }

    /**
     * Builds and returns a WorkflowRunner instance.
     * This method finalizes the workflow and prepares it for execution by topologically sorting the nodes.
     * @param options The configuration options for the build
     * @param options.onNodesCompleted A (sync or async) function to invoke when all nodes have completed
     * @returns A new `WorkflowRunner` instance ready to execute the workflow.
     *
     * @throws {Error} If no nodes have been added to the workflow.
     */
    build({
        onNodesCompleted,
    }: {
        onNodesCompleted?: (ctx: DeepReadonly<TNodeContext>, errors: NodeError[] | null) => void | Promise<void>;
    } = {}): WorkflowRunner<
        TInitialNodeContext,
        TNodeContext & { readonly initial: DeepReadonly<TInitialNodeContext> }
    > {
        if (!this.size) {
            throw new Error("Unable to build WorkflowRunner. No nodes added to the workflow");
        }
        if (onNodesCompleted && typeof onNodesCompleted !== "function") {
            throw new Error("onNodesCompleted must be a function (sync or async).");
        }
        this.#topologicalSort();
        return new WorkflowRunner<
            TInitialNodeContext,
            TNodeContext & { readonly initial: DeepReadonly<TInitialNodeContext> }
        >(this.#contextValueOrFactory, this.#topologicalOrder, this.#nodes, this.#nodeDependencies, onNodesCompleted);
    }

    /**
     * Returns the number of nodes in the workflow.
     */
    get size(): number {
        return this.#nodes.size;
    }

    /**
     * Topologically sorts the nodes in the workflow, placing the sorted order in the `_topologicalOrder` array.
     */
    #topologicalSort() {
        const visited = new Set<string>();
        const temp = new Set<string>();

        const visit = (nodeId: string) => {
            if (temp.has(nodeId)) {
                throw new Error(`Circular dependency detected involving node ${nodeId}`);
            }
            if (!visited.has(nodeId)) {
                temp.add(nodeId);
                for (const depId of this.#nodeDependencies.get(nodeId)) {
                    visit(depId);
                }
                temp.delete(nodeId);
                visited.add(nodeId);
                this.#topologicalOrder.push(nodeId);
            }
        };

        for (const nodeId of this.#nodes.keys()) {
            if (!visited.has(nodeId)) {
                visit(nodeId);
            }
        }
        visited.clear();
        temp.clear();
    }
}

/**
 * Represents a workflow runner that executes nodes in a topologically sorted order.
 * It assumes the passed nodes are already topologically sorted.
 *
 * @template TNodeContext - Type of the context each node will receive
 */
export class WorkflowRunner<TInitialNodeContext, TNodeContext extends Record<string, unknown> & { initial: unknown }> {
    readonly #context = new Context<TInitialNodeContext, TNodeContext>();
    readonly #contextValueOrFactory:
        | undefined
        | TInitialNodeContext
        | (() => DeepReadonly<TInitialNodeContext> | Promise<DeepReadonly<TInitialNodeContext>>);
    readonly #topologicalOrder: string[];
    readonly #nodes: Map<string, Node<TNodeContext, unknown, string>>;
    readonly #nodeDependencies: DependencyMap;
    readonly #onNodesCompleted?: (ctx: TNodeContext, errors: NodeError[] | null) => void | Promise<void>;
    readonly #errors: NodeError[] = [];

    constructor(
        contextValueOrFactory:
            | undefined
            | TInitialNodeContext
            | (() => DeepReadonly<TInitialNodeContext> | Promise<DeepReadonly<TInitialNodeContext>>),
        topologicalOrder: string[],
        nodes: Map<string, Node<TNodeContext, unknown, string>>,
        nodeDependencies: DependencyMap,
        onNodesCompleted?: (ctx: TNodeContext, errors: NodeError[] | null) => void | Promise<void>,
    ) {
        this.#contextValueOrFactory = contextValueOrFactory;
        this.#topologicalOrder = topologicalOrder;
        this.#nodes = nodes;
        this.#nodeDependencies = nodeDependencies;
        this.#onNodesCompleted = onNodesCompleted;
    }

    async #run(): Promise<TNodeContext> {
        if (this.#topologicalOrder.length === 0) {
            throw new Error("No nodes to run. Did you forget to call topologicalSort?");
        }
        let value: TInitialNodeContext | undefined;
        if (this.#contextValueOrFactory) {
            value =
                typeof this.#contextValueOrFactory === "function"
                    ? await (this.#contextValueOrFactory as () => TInitialNodeContext | Promise<TInitialNodeContext>)()
                    : this.#contextValueOrFactory;
            this.#context.reset(value);
        }

        const completed = new Set<string>();
        const running = new Map<string, Promise<void>>();
        const readyNodes = new Set<string>(
            this.#topologicalOrder.filter((nodeId) => {
                const node = this.#nodes.get(nodeId);
                if (!node) {
                    throw new Error(`Node ${nodeId} not found`);
                }
                return node.isEnabled && this.#nodeDependencies.get(nodeId).length === 0;
            }),
        );

        const runNode = async (nodeId: string) => {
            const node = this.#nodes.get(nodeId);
            if (!node) {
                throw new Error(`Node ${nodeId} not found`);
            }

            const startTime = Date.now();
            try {
                const result = await node.run(this.#context.value);
                await this.#context.update({ [nodeId]: result });
                completed.add(nodeId);

                // Call node-specific handler if it exists
                if (node.onCompleted) {
                    try {
                        const completionEvent: NodeCompletionEvent<TNodeContext> = {
                            nodeId,
                            status: "completed",
                            result,
                            context: this.#context.value,
                            timestamp: new Date(),
                            duration: Date.now() - startTime,
                        };
                        await node.onCompleted(completionEvent);
                    } catch (err) {
                        console.error(`Error in node completion handler for ${nodeId}:`, err);
                    }
                }
            } catch (err) {
                if (err instanceof Error) {
                    this.#errors.push(new NodeError(nodeId, err));
                }
                // completed in the sense that we won't try to run it again
                completed.add(nodeId);

                // Call node-specific handler if it exists
                if (node.onCompleted) {
                    try {
                        // Emit node failure event
                        const failureEvent: NodeCompletionEvent<TNodeContext> = {
                            nodeId,
                            status: "failed",
                            error: err instanceof Error ? new NodeError(nodeId, err) : undefined,
                            context: this.#context.value,
                            timestamp: new Date(),
                            duration: Date.now() - startTime,
                        };
                        await node.onCompleted(failureEvent);
                    } catch (err) {
                        console.error(`Error in node completion handler for ${nodeId}:`, err);
                    }
                }
            } finally {
                running.delete(nodeId);

                // Check if any dependent nodes are now ready to run
                for (const [id, n] of this.#nodes) {
                    if (!completed.has(id) && !running.has(id)) {
                        const canRun =
                            n.isEnabled &&
                            this.#nodeDependencies.get(n.id).every((depId) => {
                                const depNode = this.#nodes.get(depId);
                                return (
                                    depNode &&
                                    completed.has(depId) &&
                                    depNode.status === "completed" &&
                                    depNode.isEnabled
                                );
                            });
                        if (canRun) {
                            readyNodes.add(id);
                        }
                    }
                }
            }
        };

        while (completed.size < this.#nodes.size) {
            // Start all ready nodes
            for (const nodeId of readyNodes) {
                readyNodes.delete(nodeId);
                const promise = runNode(nodeId);
                running.set(nodeId, promise);
            }

            // Wait for at least one node to complete
            if (running.size > 0) {
                await Promise.race(running.values());
            } else {
                // no nodes are running and we have not completed all nodes
                // happens when nodes could not run due to failed dependencies
                // or when there is a set of nodes that can not be run due to
                // a disabled node
                break;
            }
        }

        if (this.#onNodesCompleted) {
            await this.#onNodesCompleted(this.#context.value, this.#errors.length > 0 ? this.#errors : null);
        }

        return this.#context.value;
    }

    /**
     * Runs the nodes in the workflow in topological order.
     * Nodes are run concurrently when possible.
     * In the event a node fails, other independent nodes will continue to run.
     *
     * @returns A promise that resolves to the completed context object when all nodes have completed.
     */
    async trigger(): Promise<TNodeContext> {
        try {
            return await this.#run();
        } finally {
            this.#context.reset(undefined);
            this.#errors.length = 0;
        }
    }

    printWorkflow(): string {
        if (this.#nodes.size === 0) {
            return "Empty workflow";
        }

        const output: string[] = ["```mermaid", "graph TD"];
        const edges = new Set<string>();

        // Helper to sanitize node IDs for Mermaid
        const sanitizeId = (id: string): string => {
            // Replace special characters with underscores
            return id.replace(/[^a-zA-Z0-9_]/g, "_");
        };

        // Helper to get node label
        const getNodeLabel = (nodeId: string): string => {
            const node = this.#nodes.get(nodeId);
            if (!node) {
                return nodeId;
            }
            return node.isEnabled ? nodeId : `${nodeId} (Disabled)`;
        };

        // Collect all edges
        for (const [nodeId, node] of this.#nodes) {
            const sanitizedNodeId = sanitizeId(nodeId);
            const nodeLabel = getNodeLabel(nodeId);

            // Add node definition
            output.push(`    ${sanitizedNodeId}["${nodeLabel}"]`);

            // Style disabled nodes
            if (!node.isEnabled) {
                output.push(`    style ${sanitizedNodeId} fill:#ccc,stroke:#999,color:#666`);
            }

            const dependencies = this.#nodeDependencies.get(nodeId);
            if (dependencies.length === 0) {
                // Root node - no incoming edges
                continue;
            }

            // Add edges from dependencies to this node
            for (const depId of dependencies) {
                const sanitizedDepId = sanitizeId(depId);
                const edge = `    ${sanitizedDepId} --> ${sanitizedNodeId}`;
                edges.add(edge);
            }
        }

        // Add all edges
        for (const edge of edges) {
            output.push(edge);
        }

        output.push("```");
        return output.join("\n");
    }
}
