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
export {
  NodeError
};
//# sourceMappingURL=error.mjs.map