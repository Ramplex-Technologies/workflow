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

import { describe, expect, test } from "vitest";

import { Node } from "./_node";

describe("Node Class", () => {
    test("constructor initializes node correctly", () => {
        const node = new Node({
            id: "test-node",
            execute: async () => "result",
        });

        expect(node.id).toBe("test-node");
        expect(node.status).toBe("pending");
    });

    test("run executes node successfully", async () => {
        const node = new Node({
            id: "test-node",
            execute: async (ctx) => `${ctx.initial}`,
        });

        const result = await node.run({ initial: "ctx" });

        expect(result).toBe("ctx");
        expect(node.status).toBe("completed");
    });

    test("run skips disabled node", async () => {
        const node = new Node({
            id: "test-node",
            execute: async (ctx) => `${ctx.initial}`,
            enabled: false,
        });

        const result = await node.run({ initial: "ctx" });

        expect(result).toBeNull();
        expect(node.status).toBe("skipped");
    });

    test("run retries on failure according to retry policy", async () => {
        let attempts = 0;
        const node = new Node({
            id: "retry-node",
            execute: async () => {
                attempts++;
                if (attempts < 3) {
                    throw new Error("Failing");
                }
                return "success";
            },
            retryPolicy: { maxRetries: 2, retryDelayMs: 10 },
        });

        const result = await node.run({ initial: null });

        expect(result).toBe("success");
        expect(attempts).toBe(3);
        expect(node.status).toBe("completed");
    });

    test("run fails after exhausting retries", async () => {
        const node = new Node({
            id: "failing-node",
            execute: async () => {
                throw new Error("Always failing");
            },
            retryPolicy: { maxRetries: 2, retryDelayMs: 10 },
        });

        await expect(node.run({ initial: null })).rejects.toThrow("Always failing");

        expect(node.status).toBe("failed");
    });

    test("errorHandler is called on failure", async () => {
        let errorHandlerCalled = false;
        const node = new Node({
            id: "error-handler-node",
            execute: async () => {
                throw new Error("Node error");
            },
            errorHandler: async (err) => {
                expect(err.message).toBe("Node error");
                errorHandlerCalled = true;
            },
        });

        await expect(node.run({ initial: null })).rejects.toThrow("Node error");

        expect(errorHandlerCalled).toBe(true);
        expect(node.status).toBe("failed");
    });

    test("constructor validates retry policy", () => {
        expect(
            () =>
                new Node({
                    id: "invalid-retry-policy",
                    execute: async () => {},
                    retryPolicy: { maxRetries: -1, retryDelayMs: 100 },
                }),
        ).toThrow("maxRetries must be a non-negative integer");

        expect(
            () =>
                new Node({
                    id: "invalid-retry-policy",
                    execute: async () => {},
                    retryPolicy: { maxRetries: 2, retryDelayMs: -100 },
                }),
        ).toThrow("retryDelayMs must be a non-negative number");
    });

    describe("enabled flag behavior", () => {
        test("node is enabled by default", () => {
            const node = new Node({
                id: "test-node",
                execute: async () => "result",
            });

            expect(node.isEnabled()).toBe(true);
        });

        test("node respects explicit enabled flag", () => {
            const enabledNode = new Node({
                id: "enabled-node",
                execute: async () => "result",
                enabled: true,
            });

            const disabledNode = new Node({
                id: "disabled-node",
                execute: async () => "result",
                enabled: false,
            });

            expect(enabledNode.isEnabled()).toBe(true);
            expect(disabledNode.isEnabled()).toBe(false);
        });

        test("disabled node skips execution and returns null", async () => {
            let executionCount = 0;
            const node = new Node({
                id: "disabled-node",
                execute: async () => {
                    executionCount++;
                    return "result";
                },
                enabled: false,
            });

            const result = await node.run({ initial: null });

            expect(result).toBeNull();
            expect(executionCount).toBe(0);
            expect(node.status).toBe("skipped");
        });

        test("disabled node skips retries", async () => {
            let executionCount = 0;
            const node = new Node({
                id: "disabled-retry-node",
                execute: async () => {
                    executionCount++;
                    throw new Error("Should not be called");
                },
                enabled: false,
                retryPolicy: { maxRetries: 3, retryDelayMs: 10 },
            });

            const result = await node.run({ initial: null });

            expect(result).toBeNull();
            expect(executionCount).toBe(0);
            expect(node.status).toBe("skipped");
        });

        test("disabled node skips error handler", async () => {
            let errorHandlerCalled = false;
            const node = new Node({
                id: "disabled-error-handler-node",
                execute: async () => {
                    throw new Error("Should not be called");
                },
                errorHandler: () => {
                    errorHandlerCalled = true;
                },
                enabled: false,
            });

            const result = await node.run({ initial: null });

            expect(result).toBeNull();
            expect(errorHandlerCalled).toBe(false);
            expect(node.status).toBe("skipped");
        });

        test("node status transitions correctly when disabled", async () => {
            const node = new Node({
                id: "status-test-node",
                execute: async () => "result",
                enabled: false,
            });

            expect(node.status).toBe("pending");

            await node.run({ initial: null });

            expect(node.status).toBe("skipped");
        });

        test("enabled node with dependencies receives correct context", async () => {
            const node = new Node({
                id: "context-test-node",
                execute: async (ctx) => {
                    expect(ctx).toEqual({
                        initial: "initial",
                        dep1: "value1",
                        dep2: "value2",
                    });
                    return "result";
                },
                dependencies: ["dep1", "dep2"],
                enabled: true,
            });

            const result = await node.run({
                initial: "initial",
                dep1: "value1",
                dep2: "value2",
            });

            expect(result).toBe("result");
            expect(node.status).toBe("completed");
        });

        test("enabled callback receives context and returns true", async () => {
            let callbackContext: Record<string, unknown> = {};
            const node = new Node({
                id: "enabled-callback-node",
                execute: async (ctx) => {
                    return `processed: ${ctx.initial}`;
                },
                enabled: (ctx) => {
                    callbackContext = ctx;
                    return true;
                },
            });

            const result = await node.run({ initial: "test-value" });

            expect(callbackContext).toEqual({ initial: "test-value" });
            expect(result).toBe("processed: test-value");
            expect(node.status).toBe("completed");
        });

        test("enabled callback receives context and returns false", async () => {
            let callbackCalled = false;
            let executeCalled = false;
            const node = new Node({
                id: "disabled-callback-node",
                execute: async () => {
                    executeCalled = true;
                    return "should not execute";
                },
                enabled: (_ctx) => {
                    callbackCalled = true;
                    return false;
                },
            });

            const result = await node.run({ initial: "test-value" });

            expect(callbackCalled).toBe(true);
            expect(executeCalled).toBe(false);
            expect(result).toBeNull();
            expect(node.status).toBe("skipped");
        });

        test("enabledType getter returns correct values", () => {
            const defaultNode = new Node({
                id: "default-node",
                execute: async () => "result",
            });
            expect(defaultNode.enabledType).toBe("enabled");

            const enabledNode = new Node({
                id: "enabled-node",
                execute: async () => "result",
                enabled: true,
            });
            expect(enabledNode.enabledType).toBe("enabled");

            const disabledNode = new Node({
                id: "disabled-node",
                execute: async () => "result",
                enabled: false,
            });
            expect(disabledNode.enabledType).toBe("disabled");

            const conditionalNode = new Node({
                id: "conditional-node",
                execute: async () => "result",
                enabled: (_ctx) => true,
            });
            expect(conditionalNode.enabledType).toBe("conditional");
        });

        test("disabled node in retry scenario", async () => {
            let attemptCount = 0;
            const node = new Node({
                id: "disabled-retry-scenario",
                execute: async () => {
                    attemptCount++;
                    if (attemptCount < 3) {
                        throw new Error("Failing");
                    }
                    return "success";
                },
                retryPolicy: { maxRetries: 2, retryDelayMs: 10 },
                enabled: false,
            });

            const result = await node.run({ initial: null });

            expect(result).toBeNull();
            expect(attemptCount).toBe(0);
            expect(node.status).toBe("skipped");
        });

        test("disabled node with non-null initial context", async () => {
            const node = new Node({
                id: "disabled-context-node",
                execute: async () => "result",
                enabled: false,
            });

            const result = await node.run({
                initial: { value: "test" },
            });

            expect(result).toBeNull();
            expect(node.status).toBe("skipped");
        });
    });
});
