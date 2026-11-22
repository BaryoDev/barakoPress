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

// Comment lines dropped, and a line ending in a backslash joined to the next, so a shell command
// that spans lines is one entry.
const code = (text: string) =>
    text
        .replace(/\\\n\s*/g, "")
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

const IDENTITY_RE = String.raw`^https://github\.com/BaryoDev/barakoPress/\.github/workflows/publish\.yml@refs/(heads/master|tags/v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?)$`;
const IDENTITY = `IDENTITY_REGEXP: '${IDENTITY_RE}'`;

describe("image signing in the publish workflow", () => {
    const publish = code(job("publish"));

    it("signs and verifies each image by digest, never by tag", () => {
        const signs = publish.filter((l) => l.startsWith("cosign sign"));
        expect(signs).toHaveLength(1);
        expect(signs[0]).toContain('"ghcr.io/baryodev/$NAME@$DIGEST"');
        expect(publish).toContain("for image in barako-press barako-press-source; do");
        const verifies = publish.filter((l) => l.includes("ghcr.io/baryodev/$NAME@$DIGEST") && !l.startsWith("cosign sign"));
        expect(verifies.length).toBeGreaterThanOrEqual(1);
        for (const l of publish.filter((l) => /^(cosign sign|cosign verify)/.test(l))) {
            expect(l).not.toMatch(/:\$(T|VERSION)/);
        }
        // Each image is attested for its own digest.
        expect(publish).toContain("subject-name: ghcr.io/baryodev/barako-press");
        expect(publish).toContain("subject-digest: ${{ steps.manifest.outputs.barako_press_digest }}");
        expect(publish).toContain("subject-name: ghcr.io/baryodev/barako-press-source");
        expect(publish).toContain("subject-digest: ${{ steps.manifest.outputs.barako_press_source_digest }}");
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
            .filter(([l]) => l.startsWith("docker buildx imagetools create --tag") && l.includes(":$FLOAT"));
        expect(moves).toHaveLength(1);
        for (const [l, i] of moves) {
            expect(i).toBeGreaterThan(attest);
            expect(i).toBeGreaterThan(sign);
            expect(l).toContain('"ghcr.io/baryodev/$NAME@$DIGEST"');
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
        const blocks = text
            .split(/^ {6}- /m)
            .filter((b) => /cosign (sign|verify)/.test(b) || b.includes("Move the floating tags to the verified images"));
        expect(blocks.length).toBeGreaterThanOrEqual(3);
        for (const b of blocks) {
            expect(b).toContain("set -euo pipefail");
            expect(b).not.toMatch(/\|\| true/);
            expect(b).not.toMatch(/continue-on-error/);
        }
        expect(text).not.toMatch(/continue-on-error/);
        expect(text).not.toMatch(/always\(\)|failure\(\)/);
        // The step that moves the tags is the last step of the job.
        const steps = text.split(/^ {6}- /m);
        expect(steps[steps.length - 1]).toContain("Move the floating tags to the verified images");
    });

    it("reads each floating tag back and compares it with the verified digest", () => {
        const move = code(job("publish").split("Move the floating tags to the verified images")[1]);
        const create = move.findIndex((l) => l.startsWith("docker buildx imagetools create --tag"));
        const read = move.findIndex((l) => l.startsWith("ACTUAL=$(docker buildx imagetools inspect") && l.includes(":$FLOAT"));
        const compare = move.findIndex((l) => l.startsWith('[ "$ACTUAL" = "$DIGEST" ]'));
        expect(create).toBeGreaterThanOrEqual(0);
        expect(read).toBeGreaterThan(create);
        expect(compare).toBeGreaterThan(read);
        expect(move[compare]).toContain("::error::$NAME");
        expect(move[compare]).toContain("exit 1");
        expect(move).toContain('for pair in "barako-press $PRESS_DIGEST" "barako-press-source $SOURCE_DIGEST"; do');
    });

    it("verifies and verify-attests by digest and passes the pinned identity and issuer to both", () => {
        const verifies = publish.filter((l) => /^cosign verify(-attestation)? /.test(l));
        expect(verifies).toHaveLength(2);
        for (const l of verifies) {
            expect(l).toMatch(/ "ghcr\.io\/baryodev\/\$[A-Za-z_]+@\$DIGEST"( > \/dev\/null)?$/);
            expect(l).not.toMatch(/ghcr\.io\/baryodev\/[^ ]*:/);
            expect(l).toContain('--certificate-identity-regexp "$IDENTITY_REGEXP"');
            expect(l).toContain('--certificate-oidc-issuer "$OIDC_ISSUER"');
        }
    });

    it("accepts master and version tags of this workflow and nothing else", () => {
        const fromWorkflow = publish
            .filter((l) => l.startsWith("IDENTITY_REGEXP:"))
            .map((l) => l.slice("IDENTITY_REGEXP: '".length, -1));
        expect(fromWorkflow).toHaveLength(2);
        const base = "https://github.com/BaryoDev/barakoPress/.github/workflows/publish.yml@";
        for (const src of fromWorkflow) {
            const re = new RegExp(src);
            for (const ok of ["refs/heads/master", "refs/tags/v1.2.3", "refs/tags/v1.2.3-rc.1"]) {
                expect(re.test(base + ok), ok).toBe(true);
            }
            for (const bad of ["refs/tags/v1-evil", "refs/tags/v9anything", "refs/heads/master-x", "refs/heads/feature"]) {
                expect(re.test(base + bad), bad).toBe(false);
            }
            expect(re.test(base.replace("barakoPress", "barakoCMS") + "refs/heads/master")).toBe(false);
            expect(re.test(base.replace("publish.yml", "release.yml") + "refs/heads/master")).toBe(false);
        }
    });

    it("documents the same identity regexp as the workflow", () => {
        const docs = readFileSync(resolve(root, "docs/deploying.md"), "utf8");
        expect(docs.split(IDENTITY_RE).length - 1).toBe(2);
    });

    it("refuses a release tag that is not on master, from a checkout with no write permissions", () => {
        const version = job("version");
        expect(version).toContain("permissions:\n      contents: read\n");
        expect(version).not.toMatch(/: write/);
        expect(version).toContain("fetch-depth: 0");
        expect(version).toContain("persist-credentials: false");
        const lines = code(version);
        const check = lines.find((l) => l.startsWith('git merge-base --is-ancestor "$TAGGED" refs/remotes/origin/master ||'));
        expect(check).toBeDefined();
        expect(check).toContain("::error::");
        expect(check).toContain("exit 1");
    });

    it("does not move latest for a prerelease", () => {
        const lines = code(job("version"));
        const skip = lines.findIndex((l) => l === 'case "$V" in *-*) LATEST=false ;; esac');
        const out = lines.findIndex((l) => l === 'echo "move_latest=$LATEST"');
        expect(skip).toBeGreaterThanOrEqual(0);
        expect(out).toBeGreaterThan(skip);
    });

    it("checks every digest file is a sha256 digest before building a manifest from it", () => {
        const step = job("publish").split("- name: Create the manifest lists")[1].split("\n      #")[0];
        expect(step).toContain('[[ "$D" =~ ^sha256:[0-9a-f]{64}$ ]] ||');
        expect(step).toContain("::error::digest for $image $arch is not a sha256 digest");
        expect(step).toContain('REFS+=("$IMG@$D")');
        expect(step).toContain('"${REFS[@]}"');
        expect(step).not.toMatch(/\$REFS\b/);
    });

    it("has no checkout and no build in the job that holds the OIDC token", () => {
        const text = job("publish");
        expect(text).not.toContain("actions/checkout");
        expect(text).not.toMatch(/\bnpm\b/);
        expect(text).not.toContain("build-push-action");
    });

    it("checks a pushed tag still points at the commit that triggered the run", () => {
        const lines = code(job("version"));
        const l = lines.find((l) => l.includes('[ "$TAGGED" = "$GITHUB_SHA" ]'));
        expect(l).toBeDefined();
        expect(l).toContain("::error::");
        expect(l).toContain("exit 1");
        expect(l).toMatch(/^refs\/tags\/v\*\) /);
    });

    it("builds the commit that was checked, never a tag name", () => {
        const version = job("version");
        expect(version).toContain('REF="$TAGGED"');
        expect(version).not.toMatch(/REF="(v\$V|\$GITHUB_REF)"/);
        expect(job("build")).toContain("ref: ${{ needs.version.outputs.ref }}");
        expect(workflow.match(/needs\.version\.outputs\.ref\b/g)).toHaveLength(1);
        expect(version).toContain("ref: ${{ steps.v.outputs.ref }}");
    });

    it("checks the architectures of the digest it resolved, not of a tag", () => {
        const step = job("publish").split("- name: The pushed images carry both architectures")[1].split("\n      - ")[0];
        expect(step).toContain('docker buildx imagetools inspect "$IMG@$DIGEST" --raw');
        expect(step).toContain("PRESS_DIGEST: ${{ steps.manifest.outputs.barako_press_digest }}");
        expect(step).not.toMatch(/\$IMG:/);
    });

    it("signs, attests, verifies and copies the digest the manifest step resolved", () => {
        const text = job("publish");
        expect(text).not.toContain("steps.sign.outputs");
        expect(text.match(/steps\.manifest\.outputs\.barako_press_digest/g)!.length).toBeGreaterThanOrEqual(5);
        expect(text.match(/steps\.manifest\.outputs\.barako_press_source_digest/g)!.length).toBeGreaterThanOrEqual(5);
        const resolves = code(text).filter((l) => l.includes("--format '{{json .Manifest}}'") && l.includes("jq -r '.digest'"));
        expect(resolves.filter((l) => l.startsWith("DIGEST=$(")).length).toBe(1);
        expect(code(text)).toContain("echo \"${image//-/_}_digest=$DIGEST\" >> \"$GITHUB_OUTPUT\"");
    });

    it("resolves no tag again after the architecture check", () => {
        const after = job("publish").split("- name: The pushed images carry both architectures")[1];
        const inspects = code(after).filter((l) => l.includes("imagetools inspect"));
        const own = inspects.filter((l) => !l.startsWith("PLATFORMS=$(") && !l.includes("imagetools inspect \"$IMG@$DIGEST\""));
        // The only other read is the floating tag read back to compare it with the verified digest.
        expect(own).toHaveLength(1);
        expect(own[0]).toMatch(/^ACTUAL=\$\(/);
        const signStep = after.split("- name: Sign every published image and verify the signature")[1].split("\n      - ")[0];
        expect(signStep).not.toContain("imagetools");
        expect(signStep).not.toMatch(/\$T\b|\$VERSION/);
    });

    it("keys the publish job concurrency on the version and does not cancel", () => {
        const text = job("publish");
        expect(text).toContain("concurrency:\n      group: publish-image-${{ needs.version.outputs.version }}\n      cancel-in-progress: false\n");
    });
});
