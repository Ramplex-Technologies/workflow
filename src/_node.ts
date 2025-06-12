/* --------------------------------------------------------------------------

  MIT License

  Copyright (c) 2025 Ramplex Technologies LLC

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

// Creates a context type with required dependencies and optional other keys
type ContextWithDependencies<TContext extends Record<string, unknown>, TDependencies extends string> = Required<
    Pick<TContext, TDependencies | "initial">
> &
    Partial<Omit<TContext, TDependencies | "initial">>;

import { setTimeout } from "node:timers/promises";

import type { NodeError } from "./error";

/**
 * Event emitted when a node completes (successfully or with error)
 */
export interface NodeCompletionEvent<TNodeContext = unknown> {
    nodeId: string;
    status: "completed" | "failed" | "skipped";
    result?: unknown;
    error?: NodeError;
    context: TNodeContext;
    timestamp: Date;
    duration?: number;
    metadata?: Record<string, unknown>;
}

/**
 * Represents the options for a node.
 *
 * @template TNodeId - string literal type representing the node ID
 * @template TNodeContext - Type of node context passed into the node execution function
 * @template TNodeReturn - Type of node return value
 * @template TPossibleNodeDependencyId - string literal type representing the possible dependencies of this node
 * @template TInput - Type of the input object passed into the node execution function and error handler
 *
 */
export type NodeOptions<
    TNodeId extends string,
    TNodeContext extends Record<string, unknown> & { initial: unknown },
    TNodeReturn,
    TPossibleNodeDependencyId extends string = never,
    TInput = [TPossibleNodeDependencyId] extends [never]
        ? TNodeContext
        : ContextWithDependencies<TNodeContext, TPossibleNodeDependencyId>,
> = {
    /**
     * The unique ID of the node.
     */
    id: TNodeId;
    /**
     * The dependencies of the node.
     */
    dependencies?: readonly TPossibleNodeDependencyId[];
    enabled?: boolean | ((ctx: TInput) => boolean);
    /**
     * The retry policy for the node.
     *
     * @default { maxRetries: 0, retryDelayMs: 0 }
     */
    retryPolicy?: RetryPolicy;
    /**
     * The function that executes the node.
     * This function receives the node context as input. It can be synchronous or asynchronous.
     *
     * @param ctx - The node context
     * @returns The return value of the node
     * @throws An error if the node execution fails after all retry attempts
     */
    execute: (ctx: TInput) => Promise<TNodeReturn> | TNodeReturn;
    /**
     * An optional error handler for the node.
     * This function receives an error and the context as input. It can be synchronous or asynchronous.
     * When an error handler is provided, it will be invoked when the node execution fails after all retry attempts.
     * The error will still be thrown after the error handler has been executed.
     *
     * @param err - The error that occurred during node execution
     * @param ctx - The node context
     * @returns A promise that resolves when the error has been handled
     * @default console.error
     */
    errorHandler?: (err: Error, ctx: TInput) => Promise<void> | void;
    /**
     * An optional completion handler for the node.
     * This function is called when the node completes (successfully or with error).
     * If provided, it will be called instead of or in addition to the global onNodeCompleted handler.
     *
     * @param event - The node completion event containing status, result, error, context, etc.
     * @returns A promise that resolves when the handler has completed
     */
    onCompleted?: (event: NodeCompletionEvent<TNodeContext>) => Promise<void> | void;
};

/**
 * Represents a node that can be executed. A node takes a context as input,
 * and returns a (potentially void) value when executed.
 *
 * @template TNodeContext - Type of node context
 * @template TNodeReturn - Type of node return value
 */
export class Node<
    TNodeContext extends Record<string, unknown> & { initial: unknown },
    TNodeReturn,
    TPossibleNodeDependencyId extends string = never,
> {
    readonly #options: NodeOptions<string, TNodeContext, TNodeReturn, TPossibleNodeDependencyId>;

    #retryPolicy: RetryPolicy = { maxRetries: 0, retryDelayMs: 0 };
    #status: NodeStatus = "pending";

    constructor(options: NodeOptions<string, TNodeContext, TNodeReturn, TPossibleNodeDependencyId>) {
        if (options.retryPolicy) {
            this.#validateRetryPolicy(options.retryPolicy);
            this.#retryPolicy = options.retryPolicy;
        }
        this.#options = options;
    }

    /**
     * Gets the node's completion handler if one was provided.
     */
    get onCompleted(): NodeOptions<string, TNodeContext, TNodeReturn, TPossibleNodeDependencyId>["onCompleted"] {
        return this.#options.onCompleted;
    }

    /**
     * Return whether this node is enabled or not
     * @param ctx - The node context, required when enabled is a function
     * @param skipCallbackIfMissingDeps - If true and enabled is a callback, returns true if dependencies are not yet in context
     */
    isEnabled(ctx?: TNodeContext, skipCallbackIfMissingDeps = false): boolean {
        if (this.#options.enabled === undefined) {
            return true;
        }
        if (typeof this.#options.enabled === "boolean") {
            return this.#options.enabled;
        }
        if (!ctx) {
            throw new Error(`Context is required to evaluate enabled function for node ${this.#options.id}`);
        }

        // If skipCallbackIfMissingDeps is true, check if all dependencies are in context
        if (skipCallbackIfMissingDeps && this.#options.dependencies) {
            for (const dep of this.#options.dependencies) {
                if (!(dep in ctx)) {
                    // Dependencies not yet available, assume enabled for now
                    return true;
                }
            }
        }

        const contextToPass = ctx as [TPossibleNodeDependencyId] extends [never]
            ? TNodeContext
            : ContextWithDependencies<TNodeContext, TPossibleNodeDependencyId>;
        return this.#options.enabled(contextToPass);
    }

    /**
     * Gets the enabled state type for display purposes
     * @returns 'enabled' | 'disabled' | 'conditional'
     */
    get enabledType(): "enabled" | "disabled" | "conditional" {
        if (this.#options.enabled === undefined || this.#options.enabled === true) {
            return "enabled";
        }
        if (this.#options.enabled === false) {
            return "disabled";
        }
        return "conditional";
    }

    /**
     * Gets the ID of the node.
     *
     * @returns The node ID
     */
    get id(): string {
        return this.#options.id;
    }

    /**
     * Executes the node with the given context, retrying if necessary
     * up to the maximum number of retries specified in the retry policy. Each retry
     * is separated by the retry delay (in ms) specified in the retry policy.
     *
     * @param {TNodeContext} ctx - The node context
     * @returns {Promise<TNodeReturn>} A promise that resolves with the node result
     * @throws {Error} If the node execution fails after all retry attempts
     */
    async run(ctx: TNodeContext): Promise<TNodeReturn | null> {
        if (!this.isEnabled(ctx)) {
            this.#status = "skipped";
            return null;
        }
        const contextToPass = ctx as [TPossibleNodeDependencyId] extends [never]
            ? TNodeContext
            : ContextWithDependencies<TNodeContext, TPossibleNodeDependencyId>;
        // we retry maxRetries times on top of the initial attempt
        for (let attempt = 0; attempt < this.#retryPolicy.maxRetries + 1; attempt++) {
            try {
                this.#status = "running";
                const result = await this.#options.execute(contextToPass);
                this.#status = "completed";
                return result;
            } catch (err) {
                if (attempt === this.#retryPolicy.maxRetries) {
                    console.error(`Node failed after ${attempt + 1} attempts: ${err}`);
                    const error = err instanceof Error ? err : new Error(`Non error throw: ${String(err)}`);
                    try {
                        if (this.#options.errorHandler) {
                            await this.#options.errorHandler(error, contextToPass);
                        } else {
                            console.error(`Error in node ${this.#options.id}: ${err}`);
                        }
                    } catch (error) {
                        console.error(`Error in node error handler for ${this.#options.id}: ${error}`);
                    }
                    this.#status = "failed";
                    throw error;
                }
                console.error(`Node failed, retrying (attempt ${attempt + 1}/${this.#retryPolicy.maxRetries}): ${err}`);
                await setTimeout(this.#retryPolicy.retryDelayMs);
            }
        }

        // This line should never be reached due to the for loop condition,
        // but TypeScript requires a return statement here
        throw new Error("Unexpected end of run method");
    }

    /**
     * Gets the status of the node.
     *
     * @returns The current status of the node
     */
    get status(): NodeStatus {
        return this.#status;
    }

    #validateRetryPolicy(retryPolicy: RetryPolicy) {
        const { maxRetries, retryDelayMs } = retryPolicy;
        if (typeof maxRetries !== "number" || maxRetries < 0 || !Number.isInteger(maxRetries)) {
            throw new Error("maxRetries must be a non-negative integer");
        }
        if (typeof retryDelayMs !== "number" || retryDelayMs < 0) {
            throw new Error("retryDelayMs must be a non-negative number");
        }
    }
}

/**
 * Defines the retry policy for a node.
 */
type RetryPolicy = {
    /**
     * The maximum number of retry attempts.
     */
    maxRetries: number;
    /**
     * The delay in milliseconds between retry attempts.
     */
    retryDelayMs: number;
};

/**
 * Represents the possible states of a node.
 *
 * - pending: Node is pending execution start
 * - running: Node is executing
 * - completed: Node has been executed successfully
 * - failed: Node has failed to execute
 * - skipped: Node was skipped due to being disabled
 */
type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";
