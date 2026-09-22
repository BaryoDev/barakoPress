// Stands in for next/server's connection(), which screens/page.js imports at module scope for
// createViewerPage. A component test renders PageView directly and never calls it, so this only
// has to exist for the import to resolve.
export async function connection() {
    throw new Error("connection() was called by a component test that named no request to be dynamic for");
}
