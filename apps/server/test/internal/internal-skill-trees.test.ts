import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function registerSkillTree(harness: TestAppHarness) {
  const rootPath = path.join(harness.config.dataDir, "tree-route-skill");
  await mkdir(path.join(rootPath, "scripts"), { recursive: true });
  await writeFile(path.join(rootPath, "SKILL.md"), "tree route bytes\n");
  await writeFile(path.join(rootPath, "scripts", "run.sh"), "#!/bin/sh\n");
  await chmod(path.join(rootPath, "SKILL.md"), 0o644);
  return {
    manifest: await harness.deps.skillTreeRegistry.readTree(rootPath),
    rootPath,
  };
}

function requestContent(
  harness: TestAppHarness,
  hostId: string,
  treeHash: string,
  paths: string[],
) {
  return harness.app.request(`/internal/skills/tree/${treeHash}/content`, {
    method: "POST",
    headers: {
      ...internalAuthHeaders(harness, { hostId }),
      "content-type": "application/json",
    },
    body: JSON.stringify({ paths }),
  });
}

describe("internal skill tree routes", () => {
  it("returns a registered tree manifest to an authenticated daemon", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-skill-tree" });
      const { manifest } = await registerSkillTree(harness);

      const response = await harness.app.request(
        `/internal/skills/tree/${manifest.treeHash}`,
        { headers: internalAuthHeaders(harness, { hostId: host.id }) },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        treeHash: manifest.treeHash,
        files: [
          {
            path: "SKILL.md",
            mode: process.platform === "win32" ? 0o666 : 0o644,
            sizeBytes: 17,
            sha256: sha256("tree route bytes\n"),
          },
          expect.objectContaining({
            path: "scripts/run.sh",
            sizeBytes: 10,
            sha256: sha256("#!/bin/sh\n"),
          }),
        ],
      });
    });
  });

  it("streams only the requested files, concatenated in request order", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-skill-content",
      });
      const { manifest } = await registerSkillTree(harness);

      const response = await requestContent(
        harness,
        host.id,
        manifest.treeHash,
        ["scripts/run.sh", "SKILL.md"],
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("27");
      await expect(response.text()).resolves.toBe(
        "#!/bin/sh\ntree route bytes\n",
      );
    });
  });

  it("rejects content requests for paths outside the manifest", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-skill-content-path",
      });
      const { manifest } = await registerSkillTree(harness);

      for (const paths of [["../secret"], ["SKILL.md", "SKILL.md"]]) {
        const response = await requestContent(
          harness,
          host.id,
          manifest.treeHash,
          paths,
        );
        expect(response.status).toBe(400);
      }
    });
  });

  it("refuses to serve content that changed after the tree was hashed", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-skill-content-changed",
      });
      const { manifest, rootPath } = await registerSkillTree(harness);
      await writeFile(path.join(rootPath, "SKILL.md"), "edited route bytes\n");

      const response = await requestContent(
        harness,
        host.id,
        manifest.treeHash,
        ["SKILL.md"],
      );

      expect(response.status).toBe(404);
    });
  });

  it("forgets a tree hash once its root is re-read with different content", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-skill-tree-superseded",
      });
      const { manifest, rootPath } = await registerSkillTree(harness);
      await writeFile(path.join(rootPath, "SKILL.md"), "edited route bytes\n");
      await harness.deps.skillTreeRegistry.readTree(rootPath);

      const response = await harness.app.request(
        `/internal/skills/tree/${manifest.treeHash}`,
        { headers: internalAuthHeaders(harness, { hostId: host.id }) },
      );

      expect(response.status).toBe(404);
    });
  });

  it("returns 404 for an unknown tree hash", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-unknown-skill-tree",
      });
      const response = await harness.app.request(
        `/internal/skills/tree/${"0".repeat(64)}`,
        { headers: internalAuthHeaders(harness, { hostId: host.id }) },
      );
      expect(response.status).toBe(404);
    });
  });
});
