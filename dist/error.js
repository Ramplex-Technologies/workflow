"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/error.ts
var error_exports = {};
__export(error_exports, {
  NodeError: () => NodeError
});
module.exports = __toCommonJS(error_exports);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  NodeError
});
//# sourceMappingURL=error.js.map