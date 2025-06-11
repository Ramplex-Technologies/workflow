// src/_node.ts
import { setTimeout } from "timers/promises";
var Node = class {
  #options;
  #retryPolicy = { maxRetries: 0, retryDelayMs: 0 };
  #status = "pending";
  constructor(options) {
    if (options.retryPolicy) {
      this.#validateRetryPolicy(options.retryPolicy);
      this.#retryPolicy = options.retryPolicy;
    }
    this.#options = options;
  }
  /**
   * Gets the node's completion handler if one was provided.
   */
  get onCompleted() {
    return this.#options.onCompleted;
  }
  /**
   * Return whether this node is enabled or not
   */
  get isEnabled() {
    return this.#options.enabled === void 0 || this.#options.enabled;
  }
  /**
   * Gets the ID of the node.
   *
   * @returns The node ID
   */
  get id() {
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
  async run(ctx) {
    if (!this.isEnabled) {
      this.#status = "skipped";
      return null;
    }
    const contextToPass = ctx;
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
          } catch (error2) {
            console.error(`Error in node error handler for ${this.#options.id}: ${error2}`);
          }
          this.#status = "failed";
          throw error;
        }
        console.error(`Node failed, retrying (attempt ${attempt + 1}/${this.#retryPolicy.maxRetries}): ${err}`);
        await setTimeout(this.#retryPolicy.retryDelayMs);
      }
    }
    throw new Error("Unexpected end of run method");
  }
  /**
   * Gets the status of the node.
   *
   * @returns The current status of the node
   */
  get status() {
    return this.#status;
  }
  #validateRetryPolicy(retryPolicy) {
    const { maxRetries, retryDelayMs } = retryPolicy;
    if (typeof maxRetries !== "number" || maxRetries < 0 || !Number.isInteger(maxRetries)) {
      throw new Error("maxRetries must be a non-negative integer");
    }
    if (typeof retryDelayMs !== "number" || retryDelayMs < 0) {
      throw new Error("retryDelayMs must be a non-negative number");
    }
  }
};
export {
  Node
};
//# sourceMappingURL=_node.mjs.map