import { beforeEach, describe, expect, test } from "vitest";

import type { NodeCompletionEvent } from "./_node";
import { NodeError } from "./error";
import { Workflow } from "./workflow";

describe("Node-Specific Event Handlers", () => {
    let nodeSpecificEvents: Record<string, NodeCompletionEvent<unknown>[]> = {};

    beforeEach(() => {
        nodeSpecificEvents = {};
    });

    test("node-specific handler works independently", async () => {
        const graph = new Workflow({ contextValue: "test" });

        graph
            .addNode({
                id: "node1",
                execute: async () => "result1",
                onCompleted: async (event) => {
                    if (!nodeSpecificEvents.node1) {
                        nodeSpecificEvents.node1 = [];
                    }
                    nodeSpecificEvents.node1.push(event);
                },
            })
            .addNode({
                id: "node2",
                execute: async () => "result2",
                // No node-specific handler
            });

        const runner = graph.build();

        await runner.trigger();

        // Only node1 handler should be called
        expect(nodeSpecificEvents.node1).toHaveLength(1);
        expect(nodeSpecificEvents.node1[0]).toMatchObject({
            nodeId: "node1",
            status: "completed",
            result: "result1",
        });

        // node2 should have no events
        expect(nodeSpecificEvents.node2).toBeUndefined();
    });

    test("node-specific handler receives failure events", async () => {
        const graph = new Workflow();
        let nodeHandlerCalled = false;
        let nodeError: NodeError | undefined;

        graph.addNode({
            id: "failingNode",
            execute: async () => {
                throw new Error("Node failed");
            },
            onCompleted: async (event) => {
                nodeHandlerCalled = true;
                nodeError = event.error;
                if (!nodeSpecificEvents.failingNode) {
                    nodeSpecificEvents.failingNode = [];
                }
                nodeSpecificEvents.failingNode.push(event);
            },
        });

        const runner = graph.build();
        await runner.trigger();

        expect(nodeHandlerCalled).toBe(true);
        expect(nodeError).toBeInstanceOf(NodeError);
        expect(nodeSpecificEvents.failingNode[0]).toMatchObject({
            nodeId: "failingNode",
            status: "failed",
        });
    });

    test("node-specific handlers can perform custom logic", async () => {
        const graph = new Workflow();
        const customMetrics: Record<string, { duration: number; size: number }> = {};

        graph
            .addNode({
                id: "dataProcessor",
                execute: async () => {
                    const data = Array(1000).fill("x");
                    return data;
                },
                onCompleted: async (event) => {
                    // Custom metric collection
                    customMetrics[event.nodeId] = {
                        duration: event.duration ?? 0,
                        size: (event.result as string[])?.length ?? 0,
                    };
                },
            })
            .addNode({
                id: "dataSummarizer",
                dependencies: ["dataProcessor"],
                execute: async (ctx) => {
                    return `Processed ${ctx.dataProcessor.length} items`;
                },
                onCompleted: async (event) => {
                    // Different custom logic
                    customMetrics[event.nodeId] = {
                        duration: event.duration ?? 0,
                        size: (event.result as string).length,
                    };
                },
            });

        await graph.build().trigger();

        expect(customMetrics.dataProcessor).toBeDefined();
        expect(customMetrics.dataProcessor.size).toBe(1000);
        expect(customMetrics.dataSummarizer).toBeDefined();
        expect(customMetrics.dataSummarizer.size).toBeGreaterThan(0);
    });

    test("error in node-specific handler doesn't prevent node completion", async () => {
        const graph = new Workflow();
        graph.addNode({
            id: "node1",
            execute: async () => "result",
            onCompleted: async () => {
                throw new Error("Handler error");
            },
        });

        const runner = graph.build();

        const result = await runner.trigger();
        expect(result).toHaveProperty("node1", "result");
    });

    test("node-specific handlers work with retry policies", async () => {
        const graph = new Workflow();
        const events: NodeCompletionEvent<unknown>[] = [];
        let attemptCount = 0;

        graph.addNode({
            id: "retryNode",
            retryPolicy: { maxRetries: 2, retryDelayMs: 10 },
            execute: async () => {
                attemptCount++;
                if (attemptCount < 3) {
                    throw new Error(`Attempt ${attemptCount}`);
                }
                return "success";
            },
            onCompleted: async (event) => {
                events.push(event);
            },
        });

        await graph.build().trigger();

        // Should only emit one completion event after all retries
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            nodeId: "retryNode",
            status: "completed",
            result: "success",
        });
        expect(attemptCount).toBe(3);
    });

    test("complex scenario with mixed handlers", async () => {
        const graph = new Workflow({ contextValue: { startTime: Date.now() } });
        const analytics: Record<string, unknown> = {};

        graph
            .addNode({
                id: "fetchData",
                execute: async () => ({ items: [1, 2, 3, 4, 5] }),
                onCompleted: async (event) => {
                    analytics.fetchMetrics = {
                        itemCount: (event.result as { items: number[] }).items.length,
                        duration: event.duration,
                    };
                },
            })
            .addNode({
                id: "processData",
                dependencies: ["fetchData"],
                execute: async (ctx) => {
                    const sum = ctx.fetchData.items.reduce((a: number, b: number) => a + b, 0);
                    return { sum, average: sum / ctx.fetchData.items.length };
                },
                // No node-specific handler
            })
            .addNode({
                id: "saveResults",
                dependencies: ["processData"],
                execute: async (ctx) => {
                    // Simulate save operation
                    return { saved: true, summary: ctx.processData };
                },
                onCompleted: async (event) => {
                    analytics.saveMetrics = {
                        success: (event.result as { saved: boolean }).saved,
                        totalDuration: Date.now() - (event.context.initial as { startTime: number }).startTime,
                    };
                },
            });

        const runner = graph.build();

        await runner.trigger();

        // Check that appropriate handlers were called
        expect(analytics.fetchMetrics).toBeDefined();
        expect(analytics.saveMetrics).toBeDefined();
        // processData has no handler so no metrics for it
        expect(analytics.processMetrics).toBeUndefined();
    });
});
