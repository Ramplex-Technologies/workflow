import { beforeEach, describe, expect, test } from "vitest";

import type { NodeCompletionEvent } from "./_node";
import { NodeError } from "./error";
import { Workflow } from "./workflow";

describe("Workflow Event Emission", () => {
    let completionEvents: NodeCompletionEvent<unknown>[] = [];

    beforeEach(() => {
        completionEvents = [];
    });

    test("should emit events for successful node completion with node-specific handlers", async () => {
        const graph = new Workflow({ contextValue: "test" });

        graph
            .addNode({
                id: "node1",
                execute: async () => "result1",
                onCompleted: async (event) => {
                    completionEvents.push(event);
                },
            })
            .addNode({
                id: "node2",
                dependencies: ["node1"],
                execute: async (ctx) => `${ctx.node1}-result2`,
            });

        const runner = graph.build();
        await runner.trigger();

        expect(completionEvents).toHaveLength(1);

        // Check first node event
        expect(completionEvents[0]).toMatchObject({
            nodeId: "node1",
            status: "completed",
            result: "result1",
        });
        expect(completionEvents[0].duration).toBeGreaterThanOrEqual(0);
        expect(completionEvents[0].timestamp).toBeInstanceOf(Date);
        expect(completionEvents[0].context).toHaveProperty("initial", "test");
        expect(completionEvents[0].context).toHaveProperty("node1", "result1");
    });

    test("should emit events for failed nodes with node-specific handlers", async () => {
        const graph = new Workflow();
        const testError = new Error("Node failed");

        graph
            .addNode({
                id: "failingNode",
                execute: async () => {
                    throw testError;
                },
                onCompleted: async (event) => {
                    completionEvents.push(event);
                },
            })
            .addNode({
                id: "dependentNode",
                dependencies: ["failingNode"],
                execute: async () => "should not run",
            });

        const runner = graph.build();

        await runner.trigger();

        expect(completionEvents).toHaveLength(1);
        expect(completionEvents[0]).toMatchObject({
            nodeId: "failingNode",
            status: "failed",
        });
        expect(completionEvents[0].error).toBeInstanceOf(NodeError);
        expect(completionEvents[0].error?.message).toBe("Node failingNode failed: Node failed");
        expect(completionEvents[0].duration).toBeGreaterThanOrEqual(0);
    });

    test("should emit events in correct order for concurrent nodes with node-specific handlers", async () => {
        const graph = new Workflow();
        const nodeOrder: string[] = [];

        graph
            .addNode({
                id: "fast",
                execute: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 10));
                    nodeOrder.push("fast");
                    return "fast-result";
                },
                onCompleted: async (event) => {
                    completionEvents.push(event);
                },
            })
            .addNode({
                id: "slow",
                execute: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    nodeOrder.push("slow");
                    return "slow-result";
                },
                onCompleted: async (event) => {
                    completionEvents.push(event);
                },
            })
            .addNode({
                id: "dependent",
                dependencies: ["fast", "slow"],
                execute: async () => {
                    nodeOrder.push("dependent");
                    return "dependent-result";
                },
                onCompleted: async (event) => {
                    completionEvents.push(event);
                },
            });

        const runner = graph.build();

        await runner.trigger();

        // Nodes should complete in the order they finish
        expect(nodeOrder).toEqual(["fast", "slow", "dependent"]);
        expect(completionEvents.map((e) => e.nodeId)).toEqual(["fast", "slow", "dependent"]);
    });

    test("should include context snapshot at time of completion with node-specific handlers", async () => {
        const graph = new Workflow({ contextValue: 100 });
        const contextSnapshots: Record<string, unknown>[] = [];

        graph
            .addNode({
                id: "node1",
                execute: async (ctx) => ctx.initial + 1,
                onCompleted: async (event) => {
                    contextSnapshots.push({ ...event.context });
                },
            })
            .addNode({
                id: "node2",
                execute: async (ctx) => ctx.initial + 2,
                onCompleted: async (event) => {
                    contextSnapshots.push({ ...event.context });
                },
            })
            .addNode({
                id: "node3",
                dependencies: ["node1", "node2"],
                execute: async (ctx) => ctx.node1 + ctx.node2,
                onCompleted: async (event) => {
                    contextSnapshots.push({ ...event.context });
                },
            });

        const runner = graph.build();

        await runner.trigger();

        // Each snapshot should show the context state at that point
        expect(contextSnapshots[0]).toHaveProperty("initial", 100);
        expect(contextSnapshots[0]).toHaveProperty("node1", 101);
        expect(contextSnapshots[0]).not.toHaveProperty("node2");

        expect(contextSnapshots[1]).toHaveProperty("initial", 100);
        expect(contextSnapshots[1]).toHaveProperty("node1", 101);
        expect(contextSnapshots[1]).toHaveProperty("node2", 102);
        expect(contextSnapshots[1]).not.toHaveProperty("node3");

        expect(contextSnapshots[2]).toHaveProperty("initial", 100);
        expect(contextSnapshots[2]).toHaveProperty("node1", 101);
        expect(contextSnapshots[2]).toHaveProperty("node2", 102);
        expect(contextSnapshots[2]).toHaveProperty("node3", 203);
    });

    test("should handle async event handlers with node-specific handlers", async () => {
        const graph = new Workflow();
        const asyncResults: string[] = [];

        graph.addNode({
            id: "node1",
            execute: async () => "result1",
            onCompleted: async (event) => {
                // Simulate async processing
                await new Promise((resolve) => setTimeout(resolve, 10));
                asyncResults.push(`processed-${event.nodeId}`);
            },
        });

        const runner = graph.build();

        await runner.trigger();

        expect(asyncResults).toEqual(["processed-node1"]);
    });

    test("should work with node-specific handlers and onNodesCompleted", async () => {
        const graph = new Workflow();
        let allNodesCompleted = false;
        const individualCompletions: string[] = [];

        graph
            .addNode({
                id: "node1",
                execute: async () => "result1",
                onCompleted: async (event) => {
                    individualCompletions.push(event.nodeId);
                },
            })
            .addNode({
                id: "node2",
                execute: async () => "result2",
                onCompleted: async (event) => {
                    individualCompletions.push(event.nodeId);
                },
            });

        const runner = graph.build({
            onNodesCompleted: async (_, errors) => {
                allNodesCompleted = true;
                expect(errors).toBeNull();
            },
        });

        await runner.trigger();

        expect(individualCompletions).toHaveLength(2);
        expect(allNodesCompleted).toBe(true);
    });

    test("should measure node duration accurately with node-specific handlers", async () => {
        const graph = new Workflow();
        const DELAY = 100;
        let duration: number | undefined;

        graph.addNode({
            id: "timedNode",
            execute: async () => {
                await new Promise((resolve) => setTimeout(resolve, DELAY));
                return "done";
            },
            onCompleted: async (event) => {
                duration = event.duration;
            },
        });

        const runner = graph.build();

        await runner.trigger();

        expect(duration).toBeDefined();
        expect(duration ?? 0).toBeGreaterThanOrEqual(DELAY - 10); // Allow small variance
        expect(duration ?? 0).toBeLessThan(DELAY + 50); // But not too much
    });
});
