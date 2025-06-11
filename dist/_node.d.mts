import { NodeError } from './error.mjs';

type ContextWithDependencies<TContext extends Record<string, unknown>, TDependencies extends string> = Required<Pick<TContext, TDependencies | "initial">> & Partial<Omit<TContext, TDependencies | "initial">>;

/**
 * Event emitted when a node completes (successfully or with error)
 */
interface NodeCompletionEvent<TNodeContext = unknown> {
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
type NodeOptions<TNodeId extends string, TNodeContext extends Record<string, unknown> & {
    initial: unknown;
}, TNodeReturn, TPossibleNodeDependencyId extends string = never, TInput = [TPossibleNodeDependencyId] extends [never] ? TNodeContext : ContextWithDependencies<TNodeContext, TPossibleNodeDependencyId>> = {
    /**
     * The unique ID of the node.
     */
    id: TNodeId;
    /**
     * The dependencies of the node.
     */
    dependencies?: readonly TPossibleNodeDependencyId[];
    enabled?: boolean;
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
declare class Node<TNodeContext extends Record<string, unknown> & {
    initial: unknown;
}, TNodeReturn, TPossibleNodeDependencyId extends string = never> {
    #private;
    constructor(options: NodeOptions<string, TNodeContext, TNodeReturn, TPossibleNodeDependencyId>);
    /**
     * Gets the node's completion handler if one was provided.
     */
    get onCompleted(): NodeOptions<string, TNodeContext, TNodeReturn, TPossibleNodeDependencyId>["onCompleted"];
    /**
     * Return whether this node is enabled or not
     */
    get isEnabled(): boolean;
    /**
     * Gets the ID of the node.
     *
     * @returns The node ID
     */
    get id(): string;
    /**
     * Executes the node with the given context, retrying if necessary
     * up to the maximum number of retries specified in the retry policy. Each retry
     * is separated by the retry delay (in ms) specified in the retry policy.
     *
     * @param {TNodeContext} ctx - The node context
     * @returns {Promise<TNodeReturn>} A promise that resolves with the node result
     * @throws {Error} If the node execution fails after all retry attempts
     */
    run(ctx: TNodeContext): Promise<TNodeReturn | null>;
    /**
     * Gets the status of the node.
     *
     * @returns The current status of the node
     */
    get status(): NodeStatus;
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

export { Node, type NodeCompletionEvent, type NodeOptions };
