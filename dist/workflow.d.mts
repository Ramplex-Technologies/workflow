import { DependencyMap } from './_dependency-map.mjs';
import { NodeOptions, Node } from './_node.mjs';
import { NodeError } from './error.mjs';

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
declare class Workflow<TInitialNodeContext = undefined, TNodeContext extends Record<string, unknown> = {
    readonly initial: DeepReadonly<TInitialNodeContext>;
}, TAllDependencyIds extends string = never> {
    #private;
    constructor(options?: {
        contextValue?: TInitialNodeContext;
    } | {
        contextFactory: () => TInitialNodeContext | Promise<TInitialNodeContext>;
    });
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
    addNode<TNodeId extends string, TNodeReturn, TNodeDependencyIds extends TAllDependencyIds = never>(options: NodeOptions<TNodeId, TNodeContext & {
        readonly initial: DeepReadonly<TInitialNodeContext>;
    }, TNodeReturn, TNodeDependencyIds>): Workflow<TInitialNodeContext, TNodeContext & {
        readonly [K in TNodeId]?: TNodeReturn;
    }, TAllDependencyIds | TNodeId>;
    /**
     * Builds and returns a WorkflowRunner instance.
     * This method finalizes the workflow and prepares it for execution by topologically sorting the nodes.
     * @param options The configuration options for the build
     * @param options.onNodesCompleted A (sync or async) function to invoke when all nodes have completed
     * @returns A new `WorkflowRunner` instance ready to execute the workflow.
     *
     * @throws {Error} If no nodes have been added to the workflow.
     */
    build({ onNodesCompleted, }?: {
        onNodesCompleted?: (ctx: DeepReadonly<TNodeContext>, errors: NodeError[] | null) => void | Promise<void>;
    }): WorkflowRunner<TInitialNodeContext, TNodeContext & {
        readonly initial: DeepReadonly<TInitialNodeContext>;
    }>;
    /**
     * Returns the number of nodes in the workflow.
     */
    get size(): number;
}
/**
 * Represents a workflow runner that executes nodes in a topologically sorted order.
 * It assumes the passed nodes are already topologically sorted.
 *
 * @template TNodeContext - Type of the context each node will receive
 */
declare class WorkflowRunner<TInitialNodeContext, TNodeContext extends Record<string, unknown> & {
    initial: unknown;
}> {
    #private;
    constructor(contextValueOrFactory: undefined | TInitialNodeContext | (() => DeepReadonly<TInitialNodeContext> | Promise<DeepReadonly<TInitialNodeContext>>), topologicalOrder: string[], nodes: Map<string, Node<TNodeContext, unknown, string>>, nodeDependencies: DependencyMap, onNodesCompleted?: (ctx: TNodeContext, errors: NodeError[] | null) => void | Promise<void>);
    /**
     * Runs the nodes in the workflow in topological order.
     * Nodes are run concurrently when possible.
     * In the event a node fails, other independent nodes will continue to run.
     *
     * @returns A promise that resolves to the completed context object when all nodes have completed.
     */
    trigger(): Promise<TNodeContext>;
    printWorkflow(): string;
}

export { Workflow, WorkflowRunner };
