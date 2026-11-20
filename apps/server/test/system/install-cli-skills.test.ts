import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hashSkillTreeFiles } from "@bb/host-daemon-contract/skill-tree";
import { describe, expect, it } from "vitest";
import {
  systemCliSkillsStatusResponseSchema,
  systemInstallCliSkillsResponseSchema,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import { seedHost, seedHostSession } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { resolveServerOwnedSkillCatalogEntries } from "../../src/services/skills/injected-skills.js";

const CLI_SKILL_MD =
  "---\nname: bb-cli\ndescription: Control bb from the CLI.\n---\n";

async function writeBuiltinCliSkill(harness: TestAppHarness): Promise<void> {
  const skillDirectory = join(
    harness.deps.config.builtinSkillsRootPath,
    "bb-cli",
  );
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), CLI_SKILL_MD);
}

async function expectedCliSkillTreeHash(
  harness: TestAppHarness,
): Promise<string> {
  const entry = (
    await resolveServerOwnedSkillCatalogEntries({
      builtinSkillsRootPath: harness.deps.config.builtinSkillsRootPath,
      dataDir: harness.deps.config.dataDir,
      logger: harness.deps.logger,
      skillTreeRegistry: harness.deps.skillTreeRegistry,
    })
  ).find(({ runtimeSource }) => runtimeSource.name === "bb-cli");
  if (entry?.runtimeSource.kind !== "tree") {
    throw new Error("The built-in bb-cli skill did not resolve to a tree");
  }
  return entry.runtimeSource.treeHash;
}

const CLI_SKILL_FILES = [
  { path: "SKILL.md", mode: 0o644, windowsMode: 0o666, content: CLI_SKILL_MD },
  {
    path: "scripts/run.sh",
    mode: 0o755,
    windowsMode: 0o666,
    content: "#!/bin/sh\necho bb\n",
  },
  {
    path: "references/locked.md",
    mode: 0o464,
    windowsMode: 0o444,
    content: "Read-only reference\n",
  },
];

async function writeCliSkillWithModes(
  harness: TestAppHarness,
): Promise<string> {
  const skillDirectory = join(
    harness.deps.config.builtinSkillsRootPath,
    "bb-cli",
  );
  for (const file of CLI_SKILL_FILES) {
    const filePath = join(skillDirectory, ...file.path.split("/"));
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content);
    await chmod(filePath, file.mode);
  }
  return hashSkillTreeFiles(
    CLI_SKILL_FILES.map((file) => ({
      path: file.path,
      mode: file.windowsMode,
      sizeBytes: Buffer.byteLength(file.content),
      sha256: createHash("sha256").update(file.content).digest("hex"),
    })),
  );
}

function statusResponse(
  hostId: string,
  treeHash: string | null,
): HostRpcHandlerResult {
  return {
    ok: true,
    result: {
      entries: [
        {
          name: "bb-cli",
          path: `/home/${hostId}/.agents/skills/bb-cli`,
          treeHash,
        },
      ],
    },
  };
}

async function readCliSkillStatuses(
  harness: TestAppHarness,
): Promise<Record<string, string>> {
  const response = await harness.app.request("/api/v1/system/cli-skills");
  expect(response.status).toBe(200);
  const body = systemCliSkillsStatusResponseSchema.parse(
    await readJson(response),
  );
  return Object.fromEntries(
    body.machines.map((machine) => [machine.hostId, machine.status]),
  );
}

function installRequest(hostIds: string[]): Request {
  return new Request("http://localhost/api/v1/system/cli-skills/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hostIds }),
  });
}

describe("install cli skills", () => {
  it("installs the built-in bb-cli tree on every requested machine", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const laptop = seedHostSession(harness.deps, { id: "host-laptop" });
      const studio = seedHostSession(harness.deps, { id: "host-studio" });
      const responders = [laptop, studio].map(({ host, session }) =>
        registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: (request) => {
            expect(request.command).toMatchObject({
              type: "host.install_global_skills",
              skills: [{ name: "bb-cli", entryPath: "SKILL.md" }],
            });
            return {
              ok: true,
              result: {
                installations: [
                  { name: "bb-cli", path: `/home/${host.id}/.agents/skills` },
                ],
              },
            };
          },
        }),
      );

      const response = await harness.app.request(
        installRequest([laptop.host.id, studio.host.id]),
      );
      expect(response.status).toBe(200);
      const body = systemInstallCliSkillsResponseSchema.parse(
        await readJson(response),
      );
      expect(body.results.map((entry) => [entry.hostId, entry.ok])).toEqual([
        ["host-laptop", true],
        ["host-studio", true],
      ]);
      for (const responder of responders) {
        expect(responder.requests).toHaveLength(1);
      }
    });
  });

  it("reports a failing machine without dropping the one that worked", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const laptop = seedHostSession(harness.deps, { id: "host-laptop" });
      const studio = seedHostSession(harness.deps, { id: "host-studio" });
      registerHostRpcResponder(harness, {
        hostId: laptop.host.id,
        sessionId: laptop.session.id,
        handle: () => ({
          ok: true,
          result: {
            installations: [{ name: "bb-cli", path: "/home/u/.agents/skills" }],
          },
        }),
      });
      registerHostRpcResponder(harness, {
        hostId: studio.host.id,
        sessionId: studio.session.id,
        handle: () => ({
          ok: false,
          errorCode: "install_failed",
          errorMessage: "disk is full",
        }),
      });

      const response = await harness.app.request(
        installRequest([laptop.host.id, studio.host.id]),
      );
      expect(response.status).toBe(200);
      const body = systemInstallCliSkillsResponseSchema.parse(
        await readJson(response),
      );
      const [installed, failed] = body.results;
      expect(installed).toMatchObject({ hostId: "host-laptop", ok: true });
      expect(failed).toMatchObject({ hostId: "host-studio", ok: false });
    });
  });

  it("rejects an unknown machine", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);

      const response = await harness.app.request(installRequest(["host-gone"]));
      expect(response.status).toBe(404);
    });
  });

  it("rejects an empty machine list", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);

      const response = await harness.app.request(installRequest([]));
      expect(response.status).toBe(400);
    });
  });

  it("maps each machine's reported hashes to a product status", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const current = seedHostSession(harness.deps, { id: "host-current" });
      const stale = seedHostSession(harness.deps, { id: "host-stale" });
      const empty = seedHostSession(harness.deps, { id: "host-empty" });
      const expectedHash = await expectedCliSkillTreeHash(harness);
      const hashByHostId: Record<string, string | null> = {
        "host-current": expectedHash,
        "host-stale": "b".repeat(64),
        "host-empty": null,
      };
      for (const { host, session } of [current, stale, empty]) {
        registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: (request) => {
            expect(request.command).toMatchObject({
              type: "host.global_skills_status",
              names: ["bb-cli"],
            });
            return {
              ok: true,
              result: {
                entries: [
                  {
                    name: "bb-cli",
                    path: `/home/${host.id}/.agents/skills/bb-cli`,
                    treeHash: hashByHostId[host.id] ?? null,
                  },
                ],
              },
            };
          },
        });
      }

      const response = await harness.app.request("/api/v1/system/cli-skills");
      expect(response.status).toBe(200);
      const body = systemCliSkillsStatusResponseSchema.parse(
        await readJson(response),
      );
      expect(
        Object.fromEntries(
          body.machines.map((machine) => [machine.hostId, machine.status]),
        ),
      ).toEqual({
        "host-current": "installed",
        "host-stale": "outdated",
        "host-empty": "missing",
      });
    });
  });

  it.skipIf(process.platform === "win32")(
    "accepts a Windows machine's tree, whose files report only 0o666 or 0o444",
    async () => {
      await withTestHarness(async (harness) => {
        const windowsTreeHash = await writeCliSkillWithModes(harness);
        const windows = seedHostSession(harness.deps, {
          id: "host-windows",
          platform: "win32",
        });
        const linux = seedHostSession(harness.deps, {
          id: "host-linux",
          platform: "linux",
        });
        for (const { host, session } of [windows, linux]) {
          registerHostRpcResponder(harness, {
            hostId: host.id,
            sessionId: session.id,
            handle: () => statusResponse(host.id, windowsTreeHash),
          });
        }

        expect(await readCliSkillStatuses(harness)).toEqual({
          "host-windows": "installed",
          "host-linux": "outdated",
        });
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "compares a Windows machine against the tree resolved before a rescan replaced it",
    async () => {
      await withTestHarness(async (harness) => {
        const windowsTreeHash = await writeCliSkillWithModes(harness);
        const skillDirectory = join(
          harness.deps.config.builtinSkillsRootPath,
          "bb-cli",
        );
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-windows",
          platform: "win32",
        });
        registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: async () => {
            await chmod(join(skillDirectory, "SKILL.md"), 0o600);
            await harness.deps.skillTreeRegistry.readTree(skillDirectory);
            return statusResponse(host.id, windowsTreeHash);
          },
        });

        expect(await readCliSkillStatuses(harness)).toEqual({
          "host-windows": "installed",
        });
      });
    },
  );

  it("reports a machine with no daemon session as unknown", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      seedHost(harness.deps, { id: "host-offline" });

      const response = await harness.app.request("/api/v1/system/cli-skills");
      const body = systemCliSkillsStatusResponseSchema.parse(
        await readJson(response),
      );
      expect(body.machines).toEqual([
        { hostId: "host-offline", hostName: "Test Host", status: "unknown" },
      ]);
    });
  });
});
