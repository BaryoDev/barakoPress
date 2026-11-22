import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The publish workflow cannot be run here, so these read the file and assert its shape: both images
 * are signed and attested by digest, only the publishing job holds the OIDC permissions, the verify
 * identity is pinned, and a floating tag moves only after the verify steps.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(resolve(root, ".github/workflows/publish.yml"), "utf8");

const code = (text: string) =>
    text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#"));

// The text of one top-level job, up to the next job at the same indent.
const job = (name: string) => {
    const start = workflow.indexOf(`\n  ${name}:\n`);
    if (start < 0) throw new Error(`no ${name} job`);
    const rest = workflow.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
    return next < 0 ? rest : rest.slice(0, next + 1);
};

const IDENTITY =
    "IDENTITY_REGEXP: '^https://github\\.com/BaryoDev/barakoPress/\\.github/workflows/publish\\.yml@refs/(heads/master|tags/v[0-9].*)$'";

describe("image signing in the publish workflow", () => {
    const publish = code(job("publish"));

    it("signs and verifies each image by digest, never by tag", () => {
        const signs = publish.filter((l) => l.startsWith("cosign sign"));
        expect(signs).toHaveLength(1);
        expect(signs[0]).toContain('"ghcr.io/baryodev/$image@$DIGEST"');
        expect(publish).toContain("for image in barako-press barako-press-source; do");
        const verifies = publish.filter((l) => l.includes("ghcr.io/baryodev/$image@$DIGEST") && !l.startsWith("cosign sign"));
        expect(verifies.length).toBeGreaterThanOrEqual(1);
        for (const l of publish.filter((l) => /^(cosign sign|cosign verify)/.test(l))) {
            expect(l).not.toMatch(/:\$(T|VERSION)/);
        }
        // Each image is attested for its own digest.
        expect(publish).toContain("subject-name: ghcr.io/baryodev/barako-press");
        expect(publish).toContain("subject-digest: ${{ steps.sign.outputs.barako_press_digest }}");
        expect(publish).toContain("subject-name: ghcr.io/baryodev/barako-press-source");
        expect(publish).toContain("subject-digest: ${{ steps.sign.outputs.barako_press_source_digest }}");
        expect(publish.filter((l) => l === "push-to-registry: true")).toHaveLength(2);
    });

    it("gives the OIDC permissions to the publish job only", () => {
        const top = workflow.split(/^jobs:/m)[0];
        expect(top).not.toMatch(/id-token:/);
        expect(job("publish")).toMatch(/id-token: write/);
        expect(job("publish")).toMatch(/attestations: write/);
        for (const name of ["version", "build", "close-milestone"]) {
            expect(job(name)).not.toMatch(/id-token:/);
            expect(job(name)).not.toMatch(/attestations:/);
        }
    });

    it("pins the verify identity to this workflow and the publishing refs, in both verify steps", () => {
        const identities = publish.filter((l) => l.startsWith("IDENTITY_REGEXP:"));
        expect(identities).toHaveLength(2);
        for (const l of identities) expect(l).toBe(IDENTITY);
        expect(publish.filter((l) => l === "OIDC_ISSUER: https://token.actions.githubusercontent.com")).toHaveLength(2);
        expect(publish.filter((l) => l.startsWith("cosign verify-attestation --type slsaprovenance1"))).toHaveLength(1);
    });

    it("builds and publishes only from master or a version tag", () => {
        const build = job("build");
        expect(build).toContain("if: github.ref == 'refs/heads/master' || startsWith(github.ref, 'refs/tags/v')");
        expect(job("publish")).toMatch(/needs: \[version, build\]/);
    });

    it("moves the floating tags only after sign, attest and verify, and copies them from the verified digest", () => {
        const idx = (pred: (l: string) => boolean) => publish.findIndex(pred);
        const sign = idx((l) => l.startsWith("cosign sign"));
        const attest = idx((l) => l.startsWith("cosign verify-attestation"));
        const moves = publish
            .map((l, i) => [l, i] as const)
            .filter(([l]) => l.includes("--tag") && l.includes(":$FLOAT"));
        expect(moves).toHaveLength(2);
        for (const [l, i] of moves) {
            expect(i).toBeGreaterThan(attest);
            expect(i).toBeGreaterThan(sign);
            expect(l).toMatch(/@\$(PRESS|SOURCE)_DIGEST"$/);
        }
        // The manifest step creates the immutable tag only.
        const create = publish.filter((l) => l.startsWith('docker buildx imagetools create --tag "$IMG:$T"'));
        expect(create).toHaveLength(1);
        expect(publish.join("\n")).not.toMatch(/--tag "\$IMG:(latest|dev)"/);
        expect(publish.join("\n")).not.toContain("TAGS=");
    });

    it("fails the job when a verify fails, and keeps the floating tags after it", () => {
        const text = job("publish");
        // Every run block that signs or verifies runs under set -e and pipefail, and none swallows a failure.
        const blocks = text.split(/^ {6}- /m).filter((b) => /cosign (sign|verify)/.test(b));
        expect(blocks.length).toBeGreaterThanOrEqual(2);
        for (const b of blocks) {
            expect(b).toContain("set -euo pipefail");
            expect(b).not.toMatch(/\|\| true/);
            expect(b).not.toMatch(/continue-on-error/);
        }
        expect(text).not.toMatch(/continue-on-error/);
        // The step that moves the tags is the last step of the job.
        const steps = text.split(/^ {6}- /m);
        expect(steps[steps.length - 1]).toContain("Move the floating tags to the verified images");
    });
});
