import { describe, expect, it } from "vitest";

import { decideNpmVersionGuard } from "./check-npm-version-guard.mjs";

const version = "0.5.0";

const files = {
  "README.md": "# sdk\n",
  "bundled-types/bb-plugin-sdk.d.ts": "export declare const a: string;\n",
  "bundled-types/bb-plugin-sdk-app.d.ts": "export declare const b: number;\n",
  "dist/index.js": "export const a = 'a';\n",
  "dist/app.js": "export const b = 1;\n",
};

const manifest = {
  exports: { ".": { import: "./dist/index.js" } },
  files: ["bundled-types", "dist", "README.md"],
  peerDependencies: { react: "^19.0.0" },
  peerDependenciesMeta: { react: { optional: true } },
  publishConfig: { access: "public" },
  repository: { type: "git", url: "git+https://example.invalid/bb.git" },
  types: "./bundled-types/bb-plugin-sdk.d.ts",
};

const local = { kind: "packed", files, manifest };

function publishedRegistry(overrides = {}) {
  return {
    kind: "published",
    files: { ...files, ...(overrides.files ?? {}) },
    manifest: { ...manifest, ...(overrides.manifest ?? {}) },
  };
}

describe("decideNpmVersionGuard", () => {
  it("passes when the package has never been published", () => {
    const decision = decideNpmVersionGuard({
      version,
      local: { kind: "not-needed", files: {}, manifest: {} },
      registry: { kind: "package-not-found" },
    });
    expect(decision).toMatchObject({ status: "pass", exitCode: 0 });
  });

  it("passes when this version is not on npm yet", () => {
    const decision = decideNpmVersionGuard({
      version,
      local: { kind: "not-needed", files: {}, manifest: {} },
      registry: { kind: "version-not-found" },
    });
    expect(decision).toMatchObject({
      status: "pass",
      exitCode: 0,
      reason: "version-not-published",
    });
  });

  it("passes when packed files and manifest match, ignoring line endings, EOF whitespace, and key order", () => {
    const decision = decideNpmVersionGuard({
      version,
      local,
      registry: publishedRegistry({
        files: {
          "bundled-types/bb-plugin-sdk.d.ts":
            "export declare const a: string;\r\n\r\n",
          "dist/index.js": "export const a = 'a';",
        },
        manifest: {
          repository: {
            url: "git+https://example.invalid/bb.git",
            type: "git",
          },
        },
      }),
    });
    expect(decision).toMatchObject({
      status: "pass",
      exitCode: 0,
      reason: "package-matches-published",
    });
  });

  it("fails on a runtime-only change with unchanged declarations", () => {
    const decision = decideNpmVersionGuard({
      version,
      local,
      registry: publishedRegistry({
        files: { "dist/index.js": "export const a = 'stale';\n" },
      }),
    });
    expect(decision).toMatchObject({
      status: "fail",
      exitCode: 1,
      reason: "package-changed-without-version-bump",
      changedFiles: ["dist/index.js"],
    });
  });

  it("fails when a published declaration changed without a version bump", () => {
    const decision = decideNpmVersionGuard({
      version,
      local,
      registry: publishedRegistry({
        files: {
          "bundled-types/bb-plugin-sdk-app.d.ts":
            "export declare const b: boolean;\n",
        },
      }),
    });
    expect(decision).toMatchObject({
      status: "fail",
      exitCode: 1,
      changedFiles: ["bundled-types/bb-plugin-sdk-app.d.ts"],
    });
    expect(decision.message).toContain("plugin-sdk-version.ts");
  });

  it("fails when a packed file is added or removed", () => {
    const withoutReadme = publishedRegistry();
    delete withoutReadme.files["README.md"];
    const decision = decideNpmVersionGuard({
      version,
      local,
      registry: withoutReadme,
    });
    expect(decision).toMatchObject({
      status: "fail",
      exitCode: 1,
      changedFiles: ["README.md"],
    });
  });

  it("fails when a consumer-facing manifest field changed", () => {
    const decision = decideNpmVersionGuard({
      version,
      local,
      registry: publishedRegistry({
        manifest: {
          exports: { ".": { import: "./dist/old.js" } },
          peerDependencies: { react: "^18.0.0" },
        },
      }),
    });
    expect(decision).toMatchObject({ status: "fail", exitCode: 1 });
    expect(decision.changedFiles).toEqual([
      "package.json (exports)",
      "package.json (peerDependencies)",
    ]);
  });

  it("ignores manifest fields that do not affect consumers", () => {
    const decision = decideNpmVersionGuard({
      version,
      local,
      registry: publishedRegistry({
        manifest: {
          description: "different",
          devDependencies: { vitest: "^1.0.0" },
          version: "0.4.0",
        },
      }),
    });
    expect(decision).toMatchObject({ status: "pass", exitCode: 0 });
  });

  it("reports registry failures as infrastructure with exit code 2", () => {
    const decision = decideNpmVersionGuard({
      version,
      local,
      registry: { kind: "network-error", message: "ENOTFOUND" },
    });
    expect(decision).toMatchObject({ status: "error", exitCode: 2 });
    expect(decision.message).toContain("could not reach registry");
  });

  it("reports a failed local build or pack as infrastructure with exit code 2", () => {
    const decision = decideNpmVersionGuard({
      version,
      local: { kind: "pack-failed", message: "turbo build failed: boom" },
      registry: publishedRegistry(),
    });
    expect(decision).toMatchObject({
      status: "error",
      exitCode: 2,
      reason: "local-package-unavailable",
    });
  });
});
