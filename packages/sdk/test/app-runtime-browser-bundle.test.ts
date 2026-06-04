import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_RUNTIME_BROWSER_BUNDLE,
  APP_RUNTIME_BROWSER_BUNDLE_SHA256,
} from "../src/app-runtime-browser-bundle.generated.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..", "..");
const generatorPath = path.join(
  repoRoot,
  "packages",
  "sdk",
  "scripts",
  "generate-app-runtime-browser-bundle.mjs",
);
const APP_RUNTIME_CODEGEN_TEST_TIMEOUT_MS = 60_000;

describe("app runtime browser bundle codegen", () => {
  it(
    "keeps the committed bundle in sync with the runtime source graph",
    () => {
      // The committed bundle is what the server embeds and serves to app
      // iframes. A stale bundle silently ships contract schemas that diverge
      // from the server, so drift must fail loudly here.
      expect(() =>
        execFileSync(process.execPath, [generatorPath, "--check"], {
          cwd: repoRoot,
          stdio: "pipe",
        }),
      ).not.toThrow();
    },
    APP_RUNTIME_CODEGEN_TEST_TIMEOUT_MS,
  );

  it("publishes the sha256 the server uses as the immutable asset cache key", () => {
    expect(APP_RUNTIME_BROWSER_BUNDLE_SHA256).toBe(
      createHash("sha256")
        .update(APP_RUNTIME_BROWSER_BUNDLE, "utf8")
        .digest("hex"),
    );
  });

  it("embeds guide templates only", () => {
    expect(APP_RUNTIME_BROWSER_BUNDLE).toContain("bbGuideApp");
    expect(APP_RUNTIME_BROWSER_BUNDLE).not.toContain("agentThreadMessage");
  });
});
