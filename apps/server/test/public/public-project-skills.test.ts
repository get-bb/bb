import type {
  DiscoveredSkill,
  HostDaemonOnlineRpcRequestMessage,
} from "@bb/host-daemon-contract";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setExperiments } from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import {
  skillContentResponseSchema,
  skillFilesResponseSchema,
  skillListResponseSchema,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const installServerRegistrySkillMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/services/skills/registry-skill-install.js", () => ({
  installServerRegistrySkill: installServerRegistrySkillMock,
}));

interface SkillRpcStub {
  requests: HostDaemonOnlineRpcRequestMessage[];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function registryHtml(args: {
  source: string;
  skillId: string;
  name?: string;
  installs?: number;
}): string {
  const id = `${args.source}/${args.skillId}`;
  return `<script type="application/ld+json">${JSON.stringify({
    "@type": "SoftwareApplication",
    name: args.name ?? args.skillId,
    description: `${args.skillId} description`,
    url: `https://www.skills.sh/${id}`,
    interactionStatistic: {
      userInteractionCount: args.installs ?? 100,
    },
  })}</script>`;
}

/**
 * Mocks the host online-RPC boundary for the skills commands. `host.list_skills`
 * returns the per-provider raw skill set; `host.delete_skill` echoes a deleted
 * path. Any other command fails loudly.
 */
function registerSkillRpc(
  harness: Parameters<typeof registerHostRpcResponder>[0],
  args: {
    hostId: string;
    sessionId: string;
    skillsByProvider?: Record<string, DiscoveredSkill[]>;
    deletedPath?: string;
    listedFiles?: string[];
    fileContents?: Record<string, string>;
    fileContentsByRoot?: Record<string, string>;
    writeConflicts?: boolean;
  },
): SkillRpcStub {
  const stub: SkillRpcStub = { requests: [] };
  const responder = registerHostRpcResponder(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    handle: (request) => {
      if (request.command.type === "host.list_skills") {
        return {
          ok: true,
          result: {
            skills: args.skillsByProvider?.[request.command.providerId] ?? [],
          },
        };
      }
      if (request.command.type === "host.delete_skill") {
        return {
          ok: true,
          result: { deletedPath: args.deletedPath ?? "/deleted" },
        };
      }
      if (request.command.type === "host.list_files") {
        const files = args.listedFiles ?? ["SKILL.md"];
        return {
          ok: true,
          result: {
            files: files.map((path) => ({
              path,
              name: path.split("/").at(-1) ?? path,
            })),
            truncated: false,
          },
        };
      }
      if (request.command.type === "host.read_file_relative") {
        return {
          ok: true,
          result: {
            path: request.command.path,
            content:
              args.fileContentsByRoot?.[request.command.rootPath] ??
              args.fileContents?.[request.command.path] ??
              "# Skill content",
            contentEncoding: "utf8" as const,
            sizeBytes: (
              args.fileContentsByRoot?.[request.command.rootPath] ??
              args.fileContents?.[request.command.path] ??
              "# Skill content"
            ).length,
            sha256: "0".repeat(64),
          },
        };
      }
      if (request.command.type === "host.write_file") {
        return {
          ok: true,
          result: args.writeConflicts
            ? {
                outcome: "conflict" as const,
                currentSha256: "2".repeat(64),
              }
            : {
                outcome: "written" as const,
                sha256: "1".repeat(64),
                sizeBytes: request.command.content.length,
              },
        };
      }
      if (request.command.type === "host.write_skill") {
        return {
          ok: true,
          result: args.writeConflicts
            ? {
                outcome: "conflict" as const,
                currentSha256: "2".repeat(64),
              }
            : {
                outcome: "written" as const,
                filePath: `/data/skills/${request.command.name}/SKILL.md`,
                sha256: "1".repeat(64),
              },
        };
      }
      throw new Error(`Unexpected RPC command ${request.command.type}`);
    },
  });
  stub.requests = responder.requests;
  return stub;
}

function discovered(
  name: string,
  rootKind: DiscoveredSkill["rootKind"],
  filePath: string,
): DiscoveredSkill {
  return {
    id: skillId(filePath),
    name,
    description: `${name} skill`,
    rootKind,
    filePath,
  };
}

function skillId(filePath: string): string {
  return `skill_${createHash("sha256").update(filePath).digest("hex")}`;
}

async function writePluginSkillFixture(rootPath: string): Promise<{
  pluginRootPath: string;
  skillFilePath: string;
}> {
  const pluginRootPath = join(rootPath, "bb-plugin-skill-catalog-fixture");
  const skillRootPath = join(pluginRootPath, "skills", "plugin-notes");
  await mkdir(skillRootPath, { recursive: true });
  await writeFile(
    join(pluginRootPath, "package.json"),
    JSON.stringify({
      name: "bb-plugin-skill-catalog-fixture",
      version: "0.1.0",
      bb: {
        name: "Skill catalog fixture",
        description: "Contributes one readable skill.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
    "utf8",
  );
  await writeFile(
    join(pluginRootPath, "server.ts"),
    "export default function plugin() {}\n",
    "utf8",
  );
  const skillFilePath = join(skillRootPath, "SKILL.md");
  await writeFile(
    skillFilePath,
    [
      "---",
      "name: plugin-notes",
      "description: Read notes contributed by the fixture plugin.",
      "---",
      "",
      "# Plugin notes",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(skillRootPath, "reference.md"),
    "# Plugin reference\n",
    "utf8",
  );
  return { pluginRootPath, skillFilePath };
}

describe("public project skills route", () => {
  it("omits registry entries whose real source has no loadable SKILL.md", async () => {
    await withTestHarness(async (harness) => {
      vi.stubEnv("VERCEL_OIDC_TOKEN", "");
      const homepage = [
        String.raw`\"source\":\"owner/available-repo\",\"skillId\":\"available-skill\",\"name\":\"Available skill\",\"installs\":200`,
        String.raw`\"source\":\"owner/stale-repo\",\"skillId\":\"stale-skill\",\"name\":\"Stale skill\",\"installs\":100`,
      ].join("\n");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL) => {
          const url = String(input);
          if (url === "https://www.skills.sh/") {
            return new Response(homepage, { status: 200 });
          }
          if (
            url.includes("raw.githubusercontent.com/owner/available-repo") &&
            url.endsWith("/skills/available-skill/SKILL.md")
          ) {
            return new Response("# Available skill\n", { status: 200 });
          }
          if (
            url === "https://www.skills.sh/owner/available-repo/available-skill"
          ) {
            return new Response(
              registryHtml({
                source: "owner/available-repo",
                skillId: "available-skill",
              }),
              { status: 200 },
            );
          }
          return new Response(null, { status: 404 });
        }),
      );

      const response = await harness.app.request(
        "/api/v1/skills-registry?page=0&perPage=24",
      );

      expect(response.status).toBe(200);
      const body = (await readJson(response)) as {
        skills: Array<{ id: string }>;
        pagination: { total: number };
      };
      expect(body.skills.map((skill) => skill.id)).toEqual([
        "owner/available-repo/available-skill",
      ]);
      expect(body.pagination.total).toBe(2);

      const staleDetail = await harness.app.request(
        "/api/v1/skills-registry/detail?source=owner%2Fstale-repo&skillId=stale-skill",
      );
      expect(staleDetail.status).toBe(404);
    });
  });

  it("imports a registry package into server-owned bb user storage", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-registry-install",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/registry-install-project",
      });
      registerSkillRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      installServerRegistrySkillMock.mockResolvedValueOnce({
        filePath: "/data/skills/find-skills/SKILL.md",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              registryHtml({
                source: "github.com/vercel-labs/skills",
                skillId: "find-skills",
              }),
              { status: 200 },
            ),
        ),
      );

      const response = await harness.app.request(
        "/api/v1/skills-registry/install",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            registrySkillId: "github.com/vercel-labs/skills/find-skills",
            projectId: project.id,
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        ok: true,
        filePath: "/data/skills/find-skills/SKILL.md",
      });
      expect(installServerRegistrySkillMock).toHaveBeenCalledWith({
        dataDir: harness.deps.config.dataDir,
        packageRef: "vercel-labs/skills",
        skillId: "find-skills",
      });
    });
  });

  it("rejects obsolete provider install fields", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-registry-invalid",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/registry-invalid-project",
      });

      const response = await harness.app.request(
        "/api/v1/skills-registry/install",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            registrySkillId: "vercel-labs/skills/find-skills",
            projectId: project.id,
            providers: ["codex"],
          }),
        },
      );

      expect(response.status).toBe(400);
    });
  });

  it("rejects a registry source that could be parsed as a CLI option", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-registry-option-source",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/registry-option-source-project",
      });

      const response = await harness.app.request(
        "/api/v1/skills-registry/install",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            registrySkillId: "--help/find-skills",
            projectId: project.id,
          }),
        },
      );

      expect(response.status).toBe(400);
    });
  });

  it("maps scope, de-dupes shared bb skills, and sorts the listing", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-skills",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/skills-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/skills-env",
      });
      // The same bb skill (identical filePath) is discovered under both
      // providers; it must be listed once with provider:null.
      const bbSkill = discovered(
        "bb-helper",
        "bb-data-dir",
        "/data/skills/bb-helper/SKILL.md",
      );
      const stub = registerSkillRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        skillsByProvider: {
          "claude-code": [
            bbSkill,
            discovered(
              "cp",
              "provider-project",
              "/cwd/.claude/skills/cp/SKILL.md",
            ),
            discovered(
              "cu",
              "provider-user",
              "/home/.claude/skills/cu/SKILL.md",
            ),
          ],
          codex: [
            bbSkill,
            discovered(
              "cx",
              "provider-user",
              "/home/.codex/skills/cx/SKILL.md",
            ),
          ],
        },
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/skills?environmentId=${environment.id}`,
      );

      expect(response.status).toBe(200);
      const body = skillListResponseSchema.parse(await readJson(response));
      expect(body.skills).toEqual([
        {
          id: skillId("/data/skills/bb-helper/SKILL.md"),
          name: "bb-helper",
          description: "bb-helper skill",
          provider: null,
          scope: "bb-user",
          pluginId: null,
          filePath: "/data/skills/bb-helper/SKILL.md",
          manageable: true,
        },
        {
          id: skillId("/cwd/.claude/skills/cp/SKILL.md"),
          name: "cp",
          description: "cp skill",
          provider: "claude-code",
          scope: "claude-project",
          pluginId: null,
          filePath: "/cwd/.claude/skills/cp/SKILL.md",
          manageable: true,
        },
        {
          id: skillId("/home/.claude/skills/cu/SKILL.md"),
          name: "cu",
          description: "cu skill",
          provider: "claude-code",
          scope: "claude-user",
          pluginId: null,
          filePath: "/home/.claude/skills/cu/SKILL.md",
          manageable: true,
        },
        {
          id: skillId("/home/.codex/skills/cx/SKILL.md"),
          name: "cx",
          description: "cx skill",
          provider: "codex",
          scope: "codex-user",
          pluginId: null,
          filePath: "/home/.codex/skills/cx/SKILL.md",
          manageable: true,
        },
      ]);
      // Queried once per command-surface provider, with the env workspace cwd.
      const listed = stub.requests
        .map((request) => request.command)
        .filter((command) => command.type === "host.list_skills");
      expect(listed.map((command) => command.providerId).sort()).toEqual([
        "claude-code",
        "codex",
      ]);
      for (const command of listed) {
        expect(command).toMatchObject({ cwd: "/tmp/skills-env" });
      }
    });
  });

  it("lists and reads a bb plugin skill from the authoritative runtime catalog", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "bb-plugin-skill-route-"));
    try {
      await withTestHarness(async (harness) => {
        setExperiments(harness.db, {
          ...defaultExperiments,
          plugins: true,
        });
        const { pluginRootPath, skillFilePath } =
          await writePluginSkillFixture(workDir);
        const installed =
          await harness.pluginService.installPath(pluginRootPath);
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-plugin-skill",
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/plugin-skill-project",
        });
        const stub = registerSkillRpc(harness, {
          hostId: host.id,
          sessionId: session.id,
        });

        const listResponse = await harness.app.request(
          `/api/v1/projects/${project.id}/skills?environmentId=`,
        );
        expect(listResponse.status).toBe(200);
        const listed = skillListResponseSchema.parse(
          await readJson(listResponse),
        );
        const matches = listed.skills.filter(
          (skill) => skill.name === "plugin-notes",
        );
        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({
          name: "plugin-notes",
          description: "Read notes contributed by the fixture plugin.",
          provider: null,
          scope: "plugin",
          pluginId: installed.id,
          filePath: skillFilePath,
          manageable: false,
        });

        const skill = matches[0];
        if (skill === undefined) throw new Error("Expected plugin skill");
        const query = new URLSearchParams({
          skillId: skill.id,
          environmentId: "",
          path: "reference.md",
        });
        const contentResponse = await harness.app.request(
          `/api/v1/projects/${project.id}/skills/content?${query}`,
        );
        expect(contentResponse.status).toBe(200);
        expect(
          skillContentResponseSchema.parse(await readJson(contentResponse)),
        ).toMatchObject({ content: "# Plugin reference\n" });
        expect(
          stub.requests.some(
            (request) => request.command.type === "host.read_file_relative",
          ),
        ).toBe(false);
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("deletes a bb skill via the confined daemon primitive", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-skill-delete",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/skill-delete-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/skill-delete-env",
      });
      const stub = registerSkillRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        skillsByProvider: {
          "claude-code": [
            discovered(
              "bb-helper",
              "bb-data-dir",
              "/data/skills/bb-helper/SKILL.md",
            ),
          ],
        },
        deletedPath: "/data/skills/bb-helper",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/skills`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            skillId: skillId("/data/skills/bb-helper/SKILL.md"),
            environmentId: environment.id,
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        deletedPath: "/data/skills/bb-helper",
      });
      const deleteCommand = stub.requests
        .map((request) => request.command)
        .find((command) => command.type === "host.delete_skill");
      expect(deleteCommand).toEqual({
        type: "host.delete_skill",
        scope: "bb-user",
        name: "bb-helper",
        cwd: "/tmp/skill-delete-env",
        rootPath: null,
      });
    });
  });

  it("deletes a user-owned provider skill through its resolved root", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-provider-skill-delete",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/provider-skill-delete-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/provider-skill-delete-env",
      });
      const stub = registerSkillRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        skillsByProvider: {
          "claude-code": [
            discovered(
              "moss-notes",
              "provider-user",
              "/home/.claude/skills/moss-notes/SKILL.md",
            ),
          ],
          codex: [],
        },
        deletedPath: "/home/.claude/skills/moss-notes",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/skills`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            skillId: skillId("/home/.claude/skills/moss-notes/SKILL.md"),
            environmentId: environment.id,
          }),
        },
      );

      expect(response.status).toBe(200);
      const deleteCommand = stub.requests
        .map((request) => request.command)
        .find((command) => command.type === "host.delete_skill");
      expect(deleteCommand).toEqual({
        type: "host.delete_skill",
        scope: "claude-user",
        name: "moss-notes",
        cwd: "/tmp/provider-skill-delete-env",
        rootPath: "/home/.claude/skills",
      });
    });
  });

  it("lists bundled skill files and reads the selected file relative to the skill root", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-skill-files",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/skill-files-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/skill-files-env",
      });
      const stub = registerSkillRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        skillsByProvider: {
          codex: [
            discovered(
              "documents",
              "provider-user",
              "/home/.codex/skills/documents/SKILL.md",
            ),
          ],
        },
        listedFiles: ["references/layout.md", "SKILL.md"],
        fileContents: { "references/layout.md": "# Layout reference" },
      });
      const query = new URLSearchParams({
        skillId: skillId("/home/.codex/skills/documents/SKILL.md"),
        environmentId: environment.id,
      });

      const filesResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/skills/files?${query}`,
      );
      expect(filesResponse.status).toBe(200);
      expect(
        skillFilesResponseSchema.parse(await readJson(filesResponse)),
      ).toEqual({
        files: ["SKILL.md", "references/layout.md"],
        truncated: false,
      });

      query.set("path", "references/layout.md");
      const contentResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/skills/content?${query}`,
      );
      expect(contentResponse.status).toBe(200);
      expect(
        skillContentResponseSchema.parse(await readJson(contentResponse)),
      ).toEqual({
        content: "# Layout reference",
        revision: "0".repeat(64),
      });
      expect(stub.requests.map((request) => request.command)).toContainEqual({
        type: "host.read_file_relative",
        rootPath: "/home/.codex/skills/documents",
        path: "references/layout.md",
        dotfiles: "deny",
      });
    });
  });

  it("uses opaque IDs to read duplicate-name skills from distinct roots", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-duplicate-skills",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/duplicate-skills-project",
      });
      const claudePath = "/home/.claude/skills/review/SKILL.md";
      const codexPath = "/home/.codex/skills/review/SKILL.md";
      registerSkillRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        skillsByProvider: {
          "claude-code": [discovered("review", "provider-user", claudePath)],
          codex: [discovered("review", "provider-user", codexPath)],
        },
        fileContentsByRoot: {
          "/home/.claude/skills/review": "# Claude review",
          "/home/.codex/skills/review": "# Codex review",
        },
      });

      const read = async (id: string) => {
        const query = new URLSearchParams({
          skillId: id,
          path: "SKILL.md",
          environmentId: "",
        });
        const response = await harness.app.request(
          `/api/v1/projects/${project.id}/skills/content?${query}`,
        );
        expect(response.status).toBe(200);
        return skillContentResponseSchema.parse(await readJson(response));
      };

      await expect(read(skillId(claudePath))).resolves.toMatchObject({
        content: "# Claude review",
      });
      await expect(read(skillId(codexPath))).resolves.toMatchObject({
        content: "# Codex review",
      });
    });
  });

  it("edits a Claude user skill through its authoritative local path", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-claude-skill-edit",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/claude-skill-edit-project",
      });
      const stub = registerSkillRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        skillsByProvider: {
          "claude-code": [
            discovered(
              "moss-notes",
              "provider-user",
              "/home/.claude/skills/moss-notes/SKILL.md",
            ),
          ],
        },
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/skills/content`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            skillId: skillId("/home/.claude/skills/moss-notes/SKILL.md"),
            environmentId: null,
            content: "# Updated Moss notes",
            revision: "0".repeat(64),
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        filePath: "/home/.claude/skills/moss-notes/SKILL.md",
        revision: "1".repeat(64),
      });
      expect(stub.requests.map((request) => request.command)).toContainEqual({
        type: "host.write_file",
        path: "/home/.claude/skills/moss-notes/SKILL.md",
        rootPath: "/home/.claude/skills/moss-notes",
        content: "# Updated Moss notes",
        contentEncoding: "utf8",
        createParents: false,
        expectedSha256: "0".repeat(64),
      });
    });
  });

  it("returns 409 for stale bb and provider skill revisions", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-stale-skill-edit",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/stale-skill-edit-project",
      });
      const bbPath = "/data/skills/review/SKILL.md";
      const providerPath = "/home/.claude/skills/review/SKILL.md";
      const stub = registerSkillRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        skillsByProvider: {
          "claude-code": [
            discovered("review", "bb-data-dir", bbPath),
            discovered("review", "provider-user", providerPath),
          ],
        },
        writeConflicts: true,
      });

      for (const id of [skillId(bbPath), skillId(providerPath)]) {
        const response = await harness.app.request(
          `/api/v1/projects/${project.id}/skills/content`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              skillId: id,
              environmentId: null,
              content: "# Stale",
              revision: "0".repeat(64),
            }),
          },
        );
        expect(response.status).toBe(409);
      }

      expect(stub.requests.map((request) => request.command)).toContainEqual({
        type: "host.write_skill",
        scope: "bb-user",
        name: "review",
        cwd: "/tmp/stale-skill-edit-project",
        content: "# Stale",
        expectedSha256: "0".repeat(64),
      });
      expect(stub.requests.map((request) => request.command)).toContainEqual({
        type: "host.write_file",
        path: providerPath,
        rootPath: "/home/.claude/skills/review",
        content: "# Stale",
        contentEncoding: "utf8",
        createParents: false,
        expectedSha256: "0".repeat(64),
      });
    });
  });

  it("rejects a bb-project delete when no workspace resolves", async () => {
    await withTestHarness(async (harness) => {
      // Primary host A is connected; the project's source lives on host B, so a
      // request without an environment resolves no cwd.
      const { host: hostA, session } = seedHostSession(harness.deps, {
        id: "host-primary",
      });
      const hostB = seedHost(harness.deps, { id: "host-source" });
      seedPrimaryHost(harness.deps, hostA.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: hostB.id,
        path: "/tmp/other-host-project",
      });
      registerSkillRpc(harness, {
        hostId: hostA.id,
        sessionId: session.id,
        skillsByProvider: {
          "claude-code": [
            discovered(
              "bb-helper",
              "bb-project",
              "/missing/.bb/skills/bb-helper/SKILL.md",
            ),
          ],
        },
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/skills`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            skillId: skillId("/missing/.bb/skills/bb-helper/SKILL.md"),
            environmentId: null,
          }),
        },
      );

      expect(response.status).toBe(409);
    });
  });
});
