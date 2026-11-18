import type { PressConfig } from "./config.js";
import { versionText } from "./versions.js";

/*
 * `{cms.Version}` style tokens in `richText` (#232). Which names exist, and the package each one
 * means, is `synced.tokens` in the config. A name that is not configured is left as typed.
 *
 * A configured token with no value yet, a registry that was down with no snapshot, is dropped
 * rather than printed, so a page never says "undefined" or shows a bare token.
 */

const TOKEN = /\{([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*)\}/g;

export function namesToken(config: PressConfig, markdown: string): boolean {
    if (typeof markdown !== "string" || !markdown.includes("{")) return false;
    return [...markdown.matchAll(TOKEN)].some((m) => Object.hasOwn(config.synced.tokens, m[1]!));
}

export async function withVersionTokens(config: PressConfig, markdown: string): Promise<string> {
    const names = new Set<string>();
    for (const m of markdown.matchAll(TOKEN)) {
        if (Object.hasOwn(config.synced.tokens, m[1]!)) names.add(m[1]!);
    }
    const values = new Map<string, string>();
    await Promise.all(
        [...names].map(async (name) => {
            values.set(name, (await versionText(config, name)) ?? "");
        }),
    );
    return markdown.replace(TOKEN, (whole, name: string) => (values.has(name) ? values.get(name)! : whole));
}
