import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const engine = fileURLToPath(new URL("./src/index.ts", import.meta.url));

export default defineConfig({
    plugins: [
        {
            // The sample plugin imports the engine by name, as a real plugin does. Inside this
            // repository that name is the source under test. Only for the examples: the tests that
            // import `barakopress` themselves are there to check the built entry points.
            name: "examples-import-the-engine-source",
            enforce: "pre",
            resolveId(id: string, importer?: string) {
                return id === "barakopress" && importer?.includes("/examples/") ? engine : null;
            },
        },
    ],
});
