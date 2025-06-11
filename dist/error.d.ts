declare class NodeError extends Error {
    id: string;
    error: Error;
    constructor(id: string, error: Error);
}

export { NodeError };
