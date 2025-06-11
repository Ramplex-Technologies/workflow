// src/error.ts
var NodeError = class extends Error {
  id;
  error;
  constructor(id, error) {
    super(`Node ${id} failed: ${error.message}`);
    this.id = id;
    this.error = error;
    this.name = "NodeError";
  }
};

// src/_context.ts
var Context = class {
  #object;
  #updateQueue;
  constructor(initialValue) {
    this.reset(initialValue);
    this.#updateQueue = Promise.resolve();
  }
  /**
   * Gets the current state of the managed object.
   */
  get value() {
    return this.#object;
  }
  /**
   * Resets the context to its initial state or a new initial object.
   */
  reset(initialValue) {
    if (initialValue !== void 0 && initialValue !== null) {
      this.#object = deepFreeze({ initial: initialValue });
    } else {
      this.#object = deepFreeze({ initial: void 0 });
    }
  }
  /**
   * Asynchronously updates the context with new values. Ensures that updates are applied in the order they are called.
   */
  update(updateValue) {
    this.#updateQueue = this.#updateQueue.then(() => {
      this.#object = deepFreeze({ ...this.#object, ...updateValue });
      return Promise.resolve();
    });
    return this.#updateQueue;
  }
};
function deepFreeze(obj) {
  const propNames = Reflect.ownKeys(obj);
  for (const name of propNames) {
    const value = obj[name];
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return Object.freeze(obj);
}

// src/_dependency-map.ts
var DependencyMap = class {
  #dependencies = /* @__PURE__ */ Object.create(null);
  add(key, value) {
    if (!this.#dependencies[key]) {
      this.#dependencies[key] = [];
    }
    this.#dependencies[key].push(value);
  }
  get(key) {
    return Object.freeze(this.#dependencies[key]?.slice() ?? []);
  }
};

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

// src/workflow.ts
var Workflow = class {
  #contextValueOrFactory = void 0;
  #nodes = /* @__PURE__ */ new Map();
  #nodeDependencies = new DependencyMap();
  #topologicalOrder = [];
  constructor(options) {
    if (!options) {
      return;
    }
    if ("contextValue" in options && "contextFactory" in options) {
      throw new Error("Cannot specify both contextValue and contextFactory");
    }
    if ("contextValue" in options) {
      if (options.contextValue !== void 0) {
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
  addNode(options) {
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
      if (depId === nodeId) {
        throw new Error(`Node ${nodeId} cannot depend on itself`);
      }
      const dependentNode = this.#nodes.get(depId);
      if (!dependentNode) {
        throw new Error(`Dependency ${depId} not found for node ${nodeId}`);
      }
      this.#nodeDependencies.add(nodeId, depId);
    }
    this.#nodes.set(nodeId, node);
    return this;
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
    onNodesCompleted
  } = {}) {
    if (!this.size) {
      throw new Error("Unable to build WorkflowRunner. No nodes added to the workflow");
    }
    if (onNodesCompleted && typeof onNodesCompleted !== "function") {
      throw new Error("onNodesCompleted must be a function (sync or async).");
    }
    this.#topologicalSort();
    return new WorkflowRunner(this.#contextValueOrFactory, this.#topologicalOrder, this.#nodes, this.#nodeDependencies, onNodesCompleted);
  }
  /**
   * Returns the number of nodes in the workflow.
   */
  get size() {
    return this.#nodes.size;
  }
  /**
   * Topologically sorts the nodes in the workflow, placing the sorted order in the `_topologicalOrder` array.
   */
  #topologicalSort() {
    const visited = /* @__PURE__ */ new Set();
    const temp = /* @__PURE__ */ new Set();
    const visit = (nodeId) => {
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
};
var WorkflowRunner = class {
  #context = new Context();
  #contextValueOrFactory;
  #topologicalOrder;
  #nodes;
  #nodeDependencies;
  #onNodesCompleted;
  #errors = [];
  constructor(contextValueOrFactory, topologicalOrder, nodes, nodeDependencies, onNodesCompleted) {
    this.#contextValueOrFactory = contextValueOrFactory;
    this.#topologicalOrder = topologicalOrder;
    this.#nodes = nodes;
    this.#nodeDependencies = nodeDependencies;
    this.#onNodesCompleted = onNodesCompleted;
  }
  async #run() {
    if (this.#topologicalOrder.length === 0) {
      throw new Error("No nodes to run. Did you forget to call topologicalSort?");
    }
    let value;
    if (this.#contextValueOrFactory) {
      value = typeof this.#contextValueOrFactory === "function" ? await this.#contextValueOrFactory() : this.#contextValueOrFactory;
      this.#context.reset(value);
    }
    const completed = /* @__PURE__ */ new Set();
    const running = /* @__PURE__ */ new Map();
    const readyNodes = new Set(
      this.#topologicalOrder.filter((nodeId) => {
        const node = this.#nodes.get(nodeId);
        if (!node) {
          throw new Error(`Node ${nodeId} not found`);
        }
        return node.isEnabled && this.#nodeDependencies.get(nodeId).length === 0;
      })
    );
    const runNode = async (nodeId) => {
      const node = this.#nodes.get(nodeId);
      if (!node) {
        throw new Error(`Node ${nodeId} not found`);
      }
      const startTime = Date.now();
      try {
        const result = await node.run(this.#context.value);
        await this.#context.update({ [nodeId]: result });
        completed.add(nodeId);
        if (node.onCompleted) {
          try {
            const completionEvent = {
              nodeId,
              status: "completed",
              result,
              context: this.#context.value,
              timestamp: /* @__PURE__ */ new Date(),
              duration: Date.now() - startTime
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
        completed.add(nodeId);
        if (node.onCompleted) {
          try {
            const failureEvent = {
              nodeId,
              status: "failed",
              error: err instanceof Error ? new NodeError(nodeId, err) : void 0,
              context: this.#context.value,
              timestamp: /* @__PURE__ */ new Date(),
              duration: Date.now() - startTime
            };
            await node.onCompleted(failureEvent);
          } catch (err2) {
            console.error(`Error in node completion handler for ${nodeId}:`, err2);
          }
        }
      } finally {
        running.delete(nodeId);
        for (const [id, n] of this.#nodes) {
          if (!completed.has(id) && !running.has(id)) {
            const canRun = n.isEnabled && this.#nodeDependencies.get(n.id).every((depId) => {
              const depNode = this.#nodes.get(depId);
              return depNode && completed.has(depId) && depNode.status === "completed" && depNode.isEnabled;
            });
            if (canRun) {
              readyNodes.add(id);
            }
          }
        }
      }
    };
    while (completed.size < this.#nodes.size) {
      for (const nodeId of readyNodes) {
        readyNodes.delete(nodeId);
        const promise = runNode(nodeId);
        running.set(nodeId, promise);
      }
      if (running.size > 0) {
        await Promise.race(running.values());
      } else {
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
  async trigger() {
    try {
      return await this.#run();
    } finally {
      this.#context.reset(void 0);
      this.#errors.length = 0;
    }
  }
  printWorkflow() {
    if (this.#nodes.size === 0) {
      return "Empty workflow";
    }
    const output = ["```mermaid", "graph TD"];
    const edges = /* @__PURE__ */ new Set();
    const sanitizeId = (id) => {
      return id.replace(/[^a-zA-Z0-9_]/g, "_");
    };
    const getNodeLabel = (nodeId) => {
      const node = this.#nodes.get(nodeId);
      if (!node) {
        return nodeId;
      }
      return node.isEnabled ? nodeId : `${nodeId} (Disabled)`;
    };
    for (const [nodeId, node] of this.#nodes) {
      const sanitizedNodeId = sanitizeId(nodeId);
      const nodeLabel = getNodeLabel(nodeId);
      output.push(`    ${sanitizedNodeId}["${nodeLabel}"]`);
      if (!node.isEnabled) {
        output.push(`    style ${sanitizedNodeId} fill:#ccc,stroke:#999,color:#666`);
      }
      const dependencies = this.#nodeDependencies.get(nodeId);
      if (dependencies.length === 0) {
        continue;
      }
      for (const depId of dependencies) {
        const sanitizedDepId = sanitizeId(depId);
        const edge = `    ${sanitizedDepId} --> ${sanitizedNodeId}`;
        edges.add(edge);
      }
    }
    for (const edge of edges) {
      output.push(edge);
    }
    output.push("```");
    return output.join("\n");
  }
};

// src/index.ts
var index_default = { NodeError, Workflow };
export {
  NodeError,
  Workflow,
  index_default as default
};
//# sourceMappingURL=index.mjs.map