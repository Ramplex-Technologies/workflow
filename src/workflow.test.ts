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

import { describe, expect, test } from "vitest";

import { DependencyMap } from "./_dependency-map";
import type { NodeOptions } from "./_node";
import type { NodeError } from "./error";
import { Workflow, WorkflowRunner } from "./workflow";

describe("Workflow", () => {
    test("addNode with no context or dependencies", () => {
        const workflow = new Workflow();
        const node = {
            id: "node1",
            execute: () => Promise.resolve("result1"),
        };
        const returnedBuilder = workflow.addNode(node);

        expect(returnedBuilder).toBe(workflow);
    });

    test("addNode with self dependency throws", () => {
        const workflow = new Workflow();
        const node: NodeOptions<"node1", { initial: unknown }, Promise<string>, "node1"> = {
            id: "node1",
            execute: () => Promise.resolve("result1"),
            dependencies: ["node1"],
        };

        // biome-ignore lint/suspicious/noExplicitAny: invalid type must be cast
        expect(() => workflow.addNode(node as any)).toThrow(/Node node1 cannot depend on itself/);
    });

    test("validate retry policy throws when maxRetries is invalid", () => {
        const workflow = new Workflow();
        const node = {
            id: "node1",
            execute: () => Promise.resolve("result1"),
            retryPolicy: { maxRetries: -1, retryDelayMs: 100 },
        };

        expect(() => workflow.addNode(node)).toThrow(/maxRetries must be a non-negative integer/);
    });

    test("validate retry policy throws when retryDelayMs is invalid", () => {
        const workflow = new Workflow();
        const node = {
            id: "node1",
            execute: () => Promise.resolve("result1"),
            retryPolicy: { maxRetries: 1, retryDelayMs: -1 },
        };

        expect(() => workflow.addNode(node)).toThrow(/retryDelayMs must be a non-negative number/);
    });

    test("Adding dependency id that is not a string throws", () => {
        const workflow = new Workflow();
        const node = {
            id: "node1",
            execute: () => Promise.resolve("result1"),
            dependencies: [1],
        };

        // biome-ignore lint/suspicious/noExplicitAny: invalid type must be cast
        expect(() => workflow.addNode(node as any)).toThrow(/Dependency ID must be a string/);
    });

    test("addNode with existing node id throws", () => {
        const workflow = new Workflow();
        const node = {
            id: "node1",
            execute: () => Promise.resolve("result1"),
        };

        workflow.addNode(node);
        expect(() => workflow.addNode(node)).toThrow(/Node with id node1 already exists/);
    });

    test("addNode with dependency that does not exist throws", () => {
        const workflow = new Workflow();
        const node = {
            id: "node1",
            execute: () => Promise.resolve("result1"),
            dependencies: ["node2"],
        };

        // biome-ignore lint/suspicious/noExplicitAny: invalid type must be cast
        expect(() => workflow.addNode(node as any)).toThrow(/Dependency node2 not found for node node1/);
    });

    test("addNode with dependencies", () => {
        const workflow = new Workflow();

        const returnedBuilder = workflow
            .addNode({
                id: "node1",
                execute: () => Promise.resolve("result1"),
            })
            .addNode({
                id: "node2",
                dependencies: ["node1"],
                execute: () => Promise.resolve("result2"),
            });

        expect(returnedBuilder).toBe(workflow);
    });

    test("build returns WorkflowRunner", () => {
        const workflow = new Workflow();

        workflow.addNode({
            id: "node1",
            execute: () => Promise.resolve("result1"),
        });
        const runner = workflow.build();

        expect(typeof runner.trigger).toBe("function");
    });

    test("build throws error when no nodes added", () => {
        const workflow = new Workflow();
        expect(() => workflow.build()).toThrow(/No nodes added to the workflow/);
    });
});

describe("WorkflowRunner", () => {
    test("trigger executes nodes in correct order", async () => {
        // biome-ignore lint/suspicious/noExplicitAny: invalid type must be cast
        let workflow: any = new Workflow();
        const executionOrder: string[] = [];

        workflow = workflow.addNode({
            id: "node1",
            execute: () => {
                executionOrder.push("node1");
                return "result1";
            },
        });
        workflow = workflow.addNode({
            id: "node2",
            dependencies: ["node1"],
            execute: () => {
                executionOrder.push("node2");
                return "result2";
            },
        });

        const runner = workflow.build();
        const result = await runner.trigger();

        expect(executionOrder).toEqual(["node1", "node2"]);
        expect(result).toEqual({
            initial: undefined,
            node1: "result1",
            node2: "result2",
        });
    });

    test("trigger skips tree of disabled nodes", async () => {
        const executionOrder: string[] = [];
        const workflow = new Workflow()
            .addNode({
                id: "node1",
                execute: () => {
                    executionOrder.push("node1");
                    return "result1";
                },
            })
            .addNode({
                id: "node2",
                dependencies: ["node1"],
                execute: () => {
                    executionOrder.push("node2");
                    return "result2";
                },
            })
            .addNode({
                id: "node3",
                execute: () => {
                    executionOrder.push("node3");
                    return "result3";
                },
                enabled: false,
            })
            .addNode({
                id: "node4",
                dependencies: ["node1", "node3"],
                execute: () => {
                    executionOrder.push("node4");
                    return "result4";
                },
            });

        const runner = workflow.build();
        const result = await runner.trigger();

        expect(executionOrder).toEqual(["node1", "node2"]);
        expect(result).toEqual({
            initial: undefined,
            node1: "result1",
            node2: "result2",
        });
    });

    test("run handles node failures", async () => {
        const workflow = new Workflow();

        workflow.addNode({
            id: "node1",
            execute: () => Promise.reject(new Error("Node 1 failed")),
        });
        workflow.addNode({
            id: "node2",
            execute: () => Promise.resolve("result2"),
        });

        const runner = workflow.build();
        const result = await runner.trigger();

        expect(result).toEqual({
            initial: undefined,
            node2: "result2",
        });
    });
});

describe("WorkflowRunner - Complex Scenarios", () => {
    test("no nodes throws", () => {
        const workflow = new Workflow();

        expect(() => workflow.build()).toThrow(/Unable to build WorkflowRunner. No nodes added to the workflow/);
    });

    test("triggering with empty topological order throws", async () => {
        const runner = new WorkflowRunner({}, [], new Map(), new DependencyMap());

        await expect(runner.trigger()).rejects.toThrow(/No nodes to run. Did you forget to call topologicalSort?/);
    });

    test("triggering with no context value throws", async () => {
        const runner = new WorkflowRunner(
            {},
            ["node1"],
            // biome-ignore lint/suspicious/noExplicitAny: invalid type must be cast
            new Map<any, any>([["node2", { id: "node1" }]]),
            new DependencyMap(),
        );

        await expect(runner.trigger()).rejects.toThrow(/Node node1 not found/);
    });

    test("mix of sync and async nodes with dependencies", async () => {
        const executionOrder: string[] = [];
        const runner = new Workflow({
            contextValue: { initialValue: 10 },
        })
            .addNode({
                id: "syncNode1",
                execute: (ctx) => {
                    executionOrder.push("syncNode1");
                    return ctx.initial.initialValue * 2;
                },
            })
            .addNode({
                id: "asyncNode1",
                dependencies: ["syncNode1"],
                execute: async (ctx) => {
                    if (!ctx.syncNode1) {
                        throw new Error("syncNode1 not found in context");
                    }
                    executionOrder.push("asyncNode1");
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    return ctx.syncNode1 + 5;
                },
            })
            .addNode({
                id: "syncNode2",
                dependencies: ["syncNode1"],
                execute: (ctx) => {
                    if (!ctx.syncNode1) {
                        throw new Error("syncNode1 not found in context");
                    }
                    executionOrder.push("syncNode2");
                    return ctx.syncNode1 * 3;
                },
            })
            .addNode({
                id: "asyncNode2",
                dependencies: ["asyncNode1", "syncNode2"],
                execute: async (ctx) => {
                    if (!ctx.asyncNode1 || !ctx.syncNode2) {
                        throw new Error("asyncNode1 or syncNode2 not found in context");
                    }
                    executionOrder.push("asyncNode2");
                    await new Promise((resolve) => setTimeout(resolve, 30));
                    return ctx.asyncNode1 + ctx.syncNode2;
                },
            })
            .build({
                onNodesCompleted: (ctx, errors) => {
                    expect(ctx).toEqual({
                        initial: { initialValue: 10 },
                        syncNode1: 20,
                        asyncNode1: 25,
                        syncNode2: 60,
                        asyncNode2: 85,
                    });
                    expect(errors).toBeNull();
                },
            });

        const result = await runner.trigger();

        expect(executionOrder).toEqual(["syncNode1", "asyncNode1", "syncNode2", "asyncNode2"]);
        expect(result).toEqual({
            initial: { initialValue: 10 },
            syncNode1: 20,
            asyncNode1: 25,
            syncNode2: 60,
            asyncNode2: 85,
        });
    });

    test("handling errors in mixed sync/async workflow", async () => {
        const runner = new Workflow()
            .addNode({
                id: "node1",
                execute: () => "result1",
            })
            .addNode({
                id: "node2",
                dependencies: ["node1"],
                execute: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    throw new Error("Node 2 failed");
                },
            })
            .addNode({
                id: "node3",
                dependencies: ["node1"],
                execute: () => "result3",
            })
            .addNode({
                id: "node4",
                dependencies: ["node2", "node3"],
                execute: (ctx) => `${ctx.node2} - ${ctx.node3}`,
            })
            .build({
                onNodesCompleted: (ctx, errors) => {
                    expect(ctx).toEqual({
                        initial: undefined,
                        node1: "result1",
                        node3: "result3",
                    });
                    expect(errors?.length).toBe(1);
                    expect(errors?.at(0)?.id).toBe("node2");
                },
            });
        const result = await runner.trigger();

        expect(result).toEqual({
            initial: undefined,
            node1: "result1",
            node3: "result3",
        });
        expect(result).not.toHaveProperty("node2");
        expect(result).not.toHaveProperty("node4");
    });

    test("concurrent execution of independent nodes", async () => {
        const workflow = new Workflow({
            contextValue: 10,
        });
        const startTime = Date.now();

        workflow.addNode({
            id: "asyncNode1",
            execute: async () => {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return "result1";
            },
        });

        workflow.addNode({
            id: "asyncNode2",
            execute: async () => {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return "result2";
            },
        });

        const runner = workflow.build();
        const result = await runner.trigger();

        const duration = Date.now() - startTime;

        expect(result).toEqual({
            initial: 10,
            asyncNode1: "result1",
            asyncNode2: "result2",
        });

        expect(duration).toBeLessThan(130);
    });

    test("complex dependency chain with mixed sync/async nodes", async () => {
        const executionOrder: string[] = [];
        const runner = new Workflow({
            contextValue: {
                initialValue: 10,
            },
        })
            .addNode({
                id: "start",
                execute: () => {
                    executionOrder.push("start");
                    return "start";
                },
            })
            .addNode({
                id: "async1",
                dependencies: ["start"],
                execute: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 30));
                    executionOrder.push("async1");
                    return "async1";
                },
            })
            .addNode({
                id: "sync1",
                dependencies: ["start"],
                execute: () => {
                    executionOrder.push("sync1");
                    return "sync1";
                },
            })
            .addNode({
                id: "async2",
                dependencies: ["async1", "sync1"],
                execute: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    executionOrder.push("async2");
                    return "async2";
                },
            })
            .addNode({
                id: "sync2",
                dependencies: ["sync1"],
                execute: () => {
                    executionOrder.push("sync2");
                    return "sync2";
                },
            })
            .addNode({
                id: "finalNode",
                dependencies: ["async2", "sync2"],
                execute: () => {
                    executionOrder.push("finalNode");
                    return "final";
                },
            })
            .build();

        const result = await runner.trigger();

        expect(result).toEqual({
            initial: { initialValue: 10 },
            start: "start",
            async1: "async1",
            sync1: "sync1",
            async2: "async2",
            sync2: "sync2",
            finalNode: "final",
        });

        // Check execution order
        expect(executionOrder[0]).toBe("start");
        expect(executionOrder.indexOf("async1")).toBeGreaterThan(executionOrder.indexOf("start"));
        expect(executionOrder.indexOf("sync1")).toBeGreaterThan(executionOrder.indexOf("start"));
        expect(executionOrder.indexOf("async2")).toBeGreaterThan(executionOrder.indexOf("async1"));
        expect(executionOrder.indexOf("async2")).toBeGreaterThan(executionOrder.indexOf("sync1"));
        expect(executionOrder.indexOf("sync2")).toBeGreaterThan(executionOrder.indexOf("sync1"));
        expect(executionOrder[executionOrder.length - 1]).toBe("finalNode");
    });

    describe("enabled flag behavior", () => {
        test("nodes are enabled by default", async () => {
            const executionOrder: string[] = [];
            const workflow = new Workflow()
                .addNode({
                    id: "node1",
                    execute: () => {
                        executionOrder.push("node1");
                        return "result1";
                    },
                })
                .build();

            await workflow.trigger();
            expect(executionOrder).toEqual(["node1"]);
        });

        test("disabled node is skipped", async () => {
            const executionOrder: string[] = [];
            const workflow = new Workflow()
                .addNode({
                    id: "node1",
                    enabled: false,
                    execute: () => {
                        executionOrder.push("node1");
                        return "result1";
                    },
                })
                .build();

            const result = await workflow.trigger();
            expect(executionOrder).toEqual([]);
            expect(result).toEqual({ initial: undefined });
        });

        test("disabled node prevents dependent nodes from running", async () => {
            const executionOrder: string[] = [];
            const workflow = new Workflow()
                .addNode({
                    id: "node1",
                    enabled: false,
                    execute: () => {
                        executionOrder.push("node1");
                        return "result1";
                    },
                })
                .addNode({
                    id: "node2",
                    dependencies: ["node1"],
                    execute: () => {
                        executionOrder.push("node2");
                        return "result2";
                    },
                })
                .build();

            const result = await workflow.trigger();
            expect(executionOrder).toEqual([]);
            expect(result).toEqual({ initial: undefined });
        });

        test("disabled node in middle of chain prevents downstream nodes", async () => {
            const executionOrder: string[] = [];
            const workflow = new Workflow()
                .addNode({
                    id: "node1",
                    execute: () => {
                        executionOrder.push("node1");
                        return "result1";
                    },
                })
                .addNode({
                    id: "node2",
                    dependencies: ["node1"],
                    enabled: false,
                    execute: () => {
                        executionOrder.push("node2");
                        return "result2";
                    },
                })
                .addNode({
                    id: "node3",
                    dependencies: ["node2"],
                    execute: () => {
                        executionOrder.push("node3");
                        return "result3";
                    },
                })
                .build();

            const result = await workflow.trigger();
            expect(executionOrder).toEqual(["node1"]);
            expect(result).toEqual({
                initial: undefined,
                node1: "result1",
            });
        });

        test("disabled node only affects its dependency chain", async () => {
            const executionOrder: string[] = [];
            const workflow = new Workflow()
                .addNode({
                    id: "start",
                    execute: () => {
                        executionOrder.push("start");
                        return "start";
                    },
                })
                .addNode({
                    id: "branch1Node",
                    dependencies: ["start"],
                    enabled: false,
                    execute: () => {
                        executionOrder.push("branch1Node");
                        return "branch1";
                    },
                })
                .addNode({
                    id: "branch1Dependent",
                    dependencies: ["branch1Node"],
                    execute: () => {
                        executionOrder.push("branch1Dependent");
                        return "branch1Dependent";
                    },
                })
                .addNode({
                    id: "branch2Node",
                    dependencies: ["start"],
                    execute: () => {
                        executionOrder.push("branch2Node");
                        return "branch2";
                    },
                })
                .addNode({
                    id: "branch2Dependent",
                    dependencies: ["branch2Node"],
                    execute: () => {
                        executionOrder.push("branch2Dependent");
                        return "branch2Dependent";
                    },
                })
                .build();

            const result = await workflow.trigger();
            expect(executionOrder).toEqual(["start", "branch2Node", "branch2Dependent"]);
            expect(result).toEqual({
                initial: undefined,
                start: "start",
                branch2Node: "branch2",
                branch2Dependent: "branch2Dependent",
            });
        });

        test("multiple disabled nodes in different chains", async () => {
            const executionOrder: string[] = [];
            const workflow = new Workflow()
                .addNode({
                    id: "root",
                    execute: () => {
                        executionOrder.push("root");
                        return "root";
                    },
                })
                .addNode({
                    id: "chain1-1",
                    dependencies: ["root"],
                    enabled: false,
                    execute: () => {
                        executionOrder.push("chain1-1");
                        return "chain1-1";
                    },
                })
                .addNode({
                    id: "chain1-2",
                    dependencies: ["chain1-1"],
                    execute: () => {
                        executionOrder.push("chain1-2");
                        return "chain1-2";
                    },
                })
                .addNode({
                    id: "chain2-1",
                    dependencies: ["root"],
                    execute: () => {
                        executionOrder.push("chain2-1");
                        return "chain2-1";
                    },
                })
                .addNode({
                    id: "chain2-2",
                    dependencies: ["chain2-1"],
                    enabled: false,
                    execute: () => {
                        executionOrder.push("chain2-2");
                        return "chain2-2";
                    },
                })
                .addNode({
                    id: "chain2-3",
                    dependencies: ["chain2-2"],
                    execute: () => {
                        executionOrder.push("chain2-3");
                        return "chain2-3";
                    },
                })
                .build();

            const result = await workflow.trigger();
            expect(executionOrder).toEqual(["root", "chain2-1"]);
            expect(result).toEqual({
                initial: undefined,
                root: "root",
                "chain2-1": "chain2-1",
            });
        });

        test("disabled node with error handling", async () => {
            const executionOrder: string[] = [];
            let errors: unknown[] = [];

            const workflow = new Workflow()
                .addNode({
                    id: "node1",
                    execute: () => {
                        executionOrder.push("node1");
                        throw new Error("Node 1 failed");
                    },
                })
                .addNode({
                    id: "node2",
                    enabled: false,
                    execute: () => {
                        executionOrder.push("node2");
                        return "result2";
                    },
                })
                .addNode({
                    id: "node3",
                    execute: () => {
                        executionOrder.push("node3");
                        return "result3";
                    },
                })
                .build({
                    onNodesCompleted: (_, nodeErrors) => {
                        if (nodeErrors) {
                            errors = [...nodeErrors];
                        }
                    },
                });

            const result = await workflow.trigger();
            expect(executionOrder).toEqual(["node1", "node3"]);
            expect(result).toEqual({
                initial: undefined,
                node3: "result3",
            });
            expect(errors).toHaveLength(1);
            expect((errors[0] as NodeError).id).toBe("node1");
        });
    });

    describe("printWorkflow Mermaid output", () => {
        test("empty workflow returns empty message", () => {
            const runner = new WorkflowRunner(undefined, [], new Map(), new DependencyMap());
            expect(runner.printWorkflow()).toBe("Empty workflow");
        });

        test("simple linear workflow", () => {
            const runner = new Workflow()
                .addNode({ id: "A", execute: () => "A" })
                .addNode({ id: "B", dependencies: ["A"], execute: () => "B" })
                .addNode({ id: "C", dependencies: ["B"], execute: () => "C" })
                .build();

            const output = runner.printWorkflow();
            expect(output).toContain("```mermaid");
            expect(output).toContain("graph TD");
            expect(output).toContain('A["A"]');
            expect(output).toContain('B["B"]');
            expect(output).toContain('C["C"]');
            expect(output).toContain("A --> B");
            expect(output).toContain("B --> C");
            expect(output).toContain("```");
        });

        test("workflow with parallel branches", () => {
            const runner = new Workflow()
                .addNode({ id: "root", execute: () => "root" })
                .addNode({ id: "branch1", dependencies: ["root"], execute: () => "b1" })
                .addNode({ id: "branch2", dependencies: ["root"], execute: () => "b2" })
                .addNode({
                    id: "merge",
                    dependencies: ["branch1", "branch2"],
                    execute: () => "merge",
                })
                .build();

            const output = runner.printWorkflow();
            expect(output).toContain("root --> branch1");
            expect(output).toContain("root --> branch2");
            expect(output).toContain("branch1 --> merge");
            expect(output).toContain("branch2 --> merge");
        });

        test("workflow with disabled nodes", () => {
            const runner = new Workflow()
                .addNode({ id: "enabled", execute: () => "enabled" })
                .addNode({
                    id: "disabled",
                    execute: () => "disabled",
                    enabled: false,
                })
                .addNode({
                    id: "dependent",
                    dependencies: ["enabled", "disabled"],
                    execute: () => "dependent",
                })
                .build();

            const output = runner.printWorkflow();
            expect(output).toContain('enabled["enabled"]');
            expect(output).toContain('disabled["disabled (Disabled)"]');
            expect(output).toContain("style disabled fill:#ccc,stroke:#999,color:#666");
        });

        test("workflow with special characters in node IDs", () => {
            const runner = new Workflow()
                .addNode({ id: "node-with-dash", execute: () => "1" })
                .addNode({ id: "node.with.dots", execute: () => "2" })
                .addNode({ id: "node@with#symbols", execute: () => "3" })
                .addNode({
                    id: "final node",
                    dependencies: ["node-with-dash", "node.with.dots", "node@with#symbols"],
                    execute: () => "final",
                })
                .build();

            const output = runner.printWorkflow();
            // Check that special characters are sanitized
            expect(output).toContain('node_with_dash["node-with-dash"]');
            expect(output).toContain('node_with_dots["node.with.dots"]');
            expect(output).toContain('node_with_symbols["node@with#symbols"]');
            expect(output).toContain('final_node["final node"]');
            expect(output).toContain("node_with_dash --> final_node");
            expect(output).toContain("node_with_dots --> final_node");
            expect(output).toContain("node_with_symbols --> final_node");
        });

        test("workflow with multiple root nodes", () => {
            const runner = new Workflow()
                .addNode({ id: "root1", execute: () => "r1" })
                .addNode({ id: "root2", execute: () => "r2" })
                .addNode({ id: "root3", execute: () => "r3" })
                .addNode({
                    id: "collector",
                    dependencies: ["root1", "root2", "root3"],
                    execute: () => "collected",
                })
                .build();

            const output = runner.printWorkflow();
            expect(output).toContain('root1["root1"]');
            expect(output).toContain('root2["root2"]');
            expect(output).toContain('root3["root3"]');
            expect(output).toContain('collector["collector"]');
            expect(output).toContain("root1 --> collector");
            expect(output).toContain("root2 --> collector");
            expect(output).toContain("root3 --> collector");
        });
    });
});
