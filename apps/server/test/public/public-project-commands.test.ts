import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DiscoveredSkill,
  HostProviderCommand,
  HostDaemonOnlineRpcRequestMessage,
} from "@bb/host-daemon-contract";
import { commandListResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
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

interface CommandRpcStub {
  commands: HostProviderCommand[];
  requests: HostDaemonOnlineRpcRequestMessage[];
  skillRequests: HostDaemonOnlineRpcRequestMessage[];
}

interface RegisterCommandRpcArgs {
  hostId: string;
  sessionId: string;
  commands: HostProviderCommand[];
  skills?: DiscoveredSkill[];
}

/**
 * Mocks provider-native command discovery and an empty project skill root.
 * Only list-commands requests are recorded for concise assertions.
 */
function registerCommandRpc(
  harness: Parameters<typeof registerHostRpcResponder>[0],
  args: RegisterCommandRpcArgs,
): CommandRpcStub {
  const stub: CommandRpcStub = {
    commands: args.commands,
    requests: [],
    skillRequests: [],
  };
  registerHostRpcResponder(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    handle: (request) => {
      if (request.command.type === "host.list_files") {
        return { ok: true, result: { files: [], truncated: false } };
      }
      if (request.command.type === "host.list_commands") {
        stub.requests.push(request);
        return { ok: true, result: { commands: stub.commands } };
      }
      if (request.command.type === "host.list_skills") {
        stub.skillRequests.push(request);
        return { ok: true, result: { skills: args.skills ?? [] } };
      }
      throw new Error(
        `Unexpected RPC command ${request.command.type} in command typeahead test`,
      );
    },
  });
  return stub;
}

function skill(
  name: string,
  origin: "project" | "user",
  overrides: Partial<HostProviderCommand> = {},
): HostProviderCommand {
  return {
    name,
    source: "skill",
    origin,
    description: overrides.description ?? null,
    argumentHint: overrides.argumentHint ?? null,
  };
}

function legacyCommand(
  name: string,
  origin: "project" | "user",
  overrides: Partial<HostProviderCommand> = {},
): HostProviderCommand {
  return {
    name,
    source: "command",
    origin,
    description: overrides.description ?? null,
    argumentHint: overrides.argumentHint ?? null,
  };
}

describe("public project command typeahead route", () => {
  it("adds configured shared skills to the provider-neutral catalog", async () => {
    await withTestHarness(
      {
        sharedSkillRoots: {
          user: [".agents/skills"],
          project: [".agents/skills"],
        },
      },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-shared-skills",
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/shared-skills",
        });
        const stub = registerCommandRpc(harness, {
          hostId: host.id,
          sessionId: session.id,
          commands: [],
          skills: [
            {
              id: `skill_${"a".repeat(64)}`,
              name: "portable-review",
              description: "Review code from one shared source.",
              filePath:
                "/tmp/shared-skills/.agents/skills/portable-review/SKILL.md",
              rootKind: "shared-project",
              linked: false,
            },
          ],
        });

        const response = await harness.app.request(
          `/api/v1/projects/${project.id}/commands?provider=pi`,
        );
        const body = commandListResponseSchema.parse(await readJson(response));

        expect(body.commands).toContainEqual({
          name: "portable-review",
          source: "skill",
          origin: "project",
          description: "Review code from one shared source.",
          argumentHint: null,
        });
        expect(stub.skillRequests[0]?.command).toEqual({
          type: "host.list_skills",
          providerId: "bb-shared",
          cwd: "/tmp/shared-skills",
          nativeSkillRoots: {
            user: [".agents/skills"],
            project: [".agents/skills"],
          },
        });
      },
    );
  });

  it("passes custom ACP native skill roots to the target host", async () => {
    await withTestHarness(
      {
        customAcpAgents: [
          {
            id: "amp",
            displayName: "Amp",
            command: "amp-acp",
            args: [],
            env: {},
            supportsManualCompaction: false,
            nativeSkillRoots: {
              user: [".agents/skills"],
              project: [".agents/skills"],
            },
          },
        ],
      },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-custom-acp-skills",
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/custom-acp-skills",
        });
        const stub = registerCommandRpc(harness, {
          hostId: host.id,
          sessionId: session.id,
          commands: [],
        });

        const response = await harness.app.request(
          `/api/v1/projects/${project.id}/commands?provider=acp-amp`,
        );

        expect(response.status).toBe(200);
        expect(stub.requests[0]?.command).toEqual({
          type: "host.list_commands",
          providerId: "acp-amp",
          cwd: "/tmp/custom-acp-skills",
          nativeSkillRoots: {
            user: [".agents/skills"],
            project: [".agents/skills"],
          },
        });
      },
    );
  });

  it("uses the server skill catalog when discovery targets another machine", async () => {
    await withTestHarness(async (harness) => {
      const primaryHost = seedHost(harness.deps, {
        id: "host-commands-primary",
      });
      seedPrimaryHost(harness.deps, primaryHost.id);
      const { host: remoteHost, session } = seedHostSession(harness.deps, {
        id: "host-commands-remote",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: primaryHost.id,
        path: "/tmp/remote-commands-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: remoteHost.id,
        projectId: project.id,
        path: "/tmp/remote-commands-env",
      });
      const skillRoot = path.join(
        harness.deps.config.dataDir,
        "skills",
        "synced-remote",
      );
      await mkdir(skillRoot, { recursive: true });
      await writeFile(
        path.join(skillRoot, "SKILL.md"),
        "---\nname: synced-remote\ndescription: Synced remote skill\n---\n",
        "utf8",
      );
      const stub = registerCommandRpc(harness, {
        hostId: remoteHost.id,
        sessionId: session.id,
        commands: [],
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=codex&environmentId=${environment.id}`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      expect(body.commands).toContainEqual({
        name: "synced-remote",
        source: "skill",
        origin: "user",
        description: "Synced remote skill",
        argumentHint: null,
      });
      expect(stub.requests[0]?.command).toEqual({
        type: "host.list_commands",
        providerId: "codex",
        cwd: "/tmp/remote-commands-env",
      });
    });
  });

  it("sorts and de-dupes the command catalog with project winning over user", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-commands-claude",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/claude-commands-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/claude-commands-env",
      });
      const stub = registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [
          // (skill, review) collision: user first, project second → project wins.
          skill("review", "user", { description: "User review skill" }),
          skill("review", "project", {
            description: "Project review skill",
            argumentHint: "<path>",
          }),
          // Same name as the skill but different source → both retained.
          legacyCommand("review", "project", {
            description: "Legacy review command",
          }),
          skill("refactor", "project"),
          skill("deploy", "user"),
        ],
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=claude-code&environmentId=${environment.id}`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      // Section rank is primary (built-ins, skills, then legacy commands),
      // with alphabetical ordering inside each section. The (skill review)
      // collision keeps the
      // project-origin entry over the user-origin one, while the cross-source
      // (command review) is retained as a distinct invocation.
      expect(body.commands).toEqual([
        {
          name: "compact",
          source: "command",
          origin: "builtin",
          description: "Compact context",
          argumentHint: null,
        },
        {
          name: "deploy",
          source: "skill",
          origin: "user",
          description: null,
          argumentHint: null,
        },
        {
          name: "refactor",
          source: "skill",
          origin: "project",
          description: null,
          argumentHint: null,
        },
        {
          name: "review",
          source: "skill",
          origin: "project",
          description: "Project review skill",
          argumentHint: "<path>",
        },
        {
          name: "review",
          source: "command",
          origin: "project",
          description: "Legacy review command",
          argumentHint: null,
        },
      ]);

      // Exactly one RPC, carrying the requested provider + resolved env cwd.
      expect(stub.requests.map((request) => request.command)).toEqual([
        {
          type: "host.list_commands",
          providerId: "claude-code",
          cwd: "/tmp/claude-commands-env",
        },
      ]);
    });
  });

  it("returns codex skills for a codex request", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-commands-codex",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/codex-commands-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/codex-commands-env",
      });
      const stub = registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [
          skill("prd", "user", { description: "Product requirements" }),
          skill("skill-installer", "project"),
        ],
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=codex&environmentId=${environment.id}`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      expect(body.commands.map((command) => command.name)).toEqual([
        "compact",
        "prd",
        "skill-installer",
      ]);
      expect(stub.requests[0]?.command).toEqual({
        type: "host.list_commands",
        providerId: "codex",
        cwd: "/tmp/codex-commands-env",
      });
    });
  });

  it("keeps inherited bb skill roots out of provider-native discovery", async () => {
    await withTestHarness(
      {
        inheritedSkillsRootPaths: ["/tmp/bb-parent-skills"],
      },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-commands-inherited-skills",
        });
        seedPrimaryHost(harness.deps, host.id);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/inherited-skills-project",
        });
        const stub = registerCommandRpc(harness, {
          hostId: host.id,
          sessionId: session.id,
          commands: [
            skill("stories", "user", {
              description: "Show Ladle story links",
            }),
          ],
        });

        const response = await harness.app.request(
          `/api/v1/projects/${project.id}/commands?provider=codex&environmentId=`,
        );

        expect(response.status).toBe(200);
        const body = commandListResponseSchema.parse(await readJson(response));
        expect(body.commands.map((command) => command.name)).toEqual([
          "compact",
          "stories",
        ]);
        expect(stub.requests[0]?.command).toEqual({
          type: "host.list_commands",
          providerId: "codex",
          cwd: "/tmp/inherited-skills-project",
        });
      },
    );
  });

  it("returns the complete snapshot for local composer filtering", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-commands-direct-skill",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/direct-skill-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/direct-skill-env",
      });
      registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [
          skill("alpha-review-notes", "user"),
          skill("ottonomous:review", "user"),
          skill("zeta-review", "user"),
        ],
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=codex&environmentId=${environment.id}`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      expect(body.commands.map((command) => command.name)).toEqual([
        "compact",
        "alpha-review-notes",
        "ottonomous:review",
        "zeta-review",
      ]);
    });
  });

  it("returns an empty list without an RPC for a provider with no command surface", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-commands-unknown",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const stub = registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [skill("anything", "user")],
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=unknown-provider&environmentId=${environment.id}`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      expect(body).toEqual({ commands: [] });
      // No daemon roundtrip for a provider without a command surface.
      expect(stub.requests).toEqual([]);
    });
  });

  it("lists skills for pi via the shared command surface", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-commands-pi",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/pi-commands-env",
      });
      const stub = registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [skill("bb-cli", "user", { description: "Use the bb CLI" })],
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=pi&environmentId=${environment.id}`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      expect(body.commands.map((command) => command.name)).toEqual([
        "compact",
        "bb-cli",
      ]);
      expect(stub.requests[0]?.command).toEqual({
        type: "host.list_commands",
        providerId: "pi",
        cwd: "/tmp/pi-commands-env",
      });
    });
  });

  it("falls back to the project source (cwd) with no environmentId and returns user-origin entries", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-commands-no-env",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/no-env-project",
      });
      const stub = registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [skill("user-only", "user", { description: "Home skill" })],
      });

      // environmentId="" encodes null on the wire → the new-thread composer
      // path, which has no environment yet.
      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=claude-code&environmentId=`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      expect(body.commands.map((command) => command.name)).toEqual([
        "compact",
        "user-only",
      ]);
      // Falls back to the project source path on the primary host, since the
      // project has a local-path source even though no environment is given.
      expect(stub.requests[0]?.command).toEqual({
        type: "host.list_commands",
        providerId: "claude-code",
        cwd: "/tmp/no-env-project",
      });
    });
  });

  it("degrades to the project source (no 409) when the given environment is still provisioning", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-commands-provisioning",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/provisioning-project",
      });
      // Environment exists but is NOT ready — a freshly-created thread whose
      // worktree is still provisioning. The route must not 409; it degrades to
      // the project source path and still returns user-home entries.
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/provisioning-env",
        status: "provisioning",
      });
      const stub = registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [skill("user-only", "user", { description: "Home skill" })],
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=claude-code&environmentId=${environment.id}`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      expect(body.commands.map((command) => command.name)).toEqual([
        "compact",
        "user-only",
      ]);
      // Not the provisioning env path; the project source path on the primary host.
      expect(stub.requests[0]?.command).toEqual({
        type: "host.list_commands",
        providerId: "claude-code",
        cwd: "/tmp/provisioning-project",
      });
    });
  });

  it("passes cwd: null when there is neither a given environment nor a project source", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-commands-no-source",
      });
      seedPrimaryHost(harness.deps, host.id);
      // Source-less (for the primary host) project: seed the project's source
      // on a different host so the primary host has no local-path source.
      const otherHost = seedHost(harness.deps, { id: "host-commands-other" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: otherHost.id,
        path: "/tmp/other-host-project",
      });
      const stub = registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [skill("user-only", "user")],
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=claude-code&environmentId=`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      expect(body.commands.map((command) => command.name)).toEqual([
        "compact",
        "user-only",
      ]);
      expect(stub.requests[0]?.command).toEqual({
        type: "host.list_commands",
        providerId: "claude-code",
        cwd: null,
      });
    });
  });

  it("lists user-home commands for the personal project", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-commands-personal",
      });
      seedPrimaryHost(harness.deps, host.id);
      const stub = registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [skill("home-skill", "user")],
      });

      const response = await harness.app.request(
        `/api/v1/projects/${PERSONAL_PROJECT_ID}/commands?provider=codex&environmentId=`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      expect(body.commands.map((command) => command.name)).toEqual([
        "compact",
        "home-skill",
      ]);
      expect(stub.requests[0]?.command).toEqual({
        type: "host.list_commands",
        providerId: "codex",
        cwd: null,
      });
    });
  });

  it("returns an error response when the host is offline", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-commands-offline" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=claude-code&environmentId=${environment.id}`,
      );

      expect(response.status).toBe(502);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "host_unavailable",
      });
    });
  });

  it("returns the full command catalog in one snapshot", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-commands-limit",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/limit-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/limit-env",
      });
      registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [
          skill("alpha", "project"),
          skill("bravo", "project"),
          skill("charlie", "project"),
          skill("delta", "project"),
        ],
      });

      const fullResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=claude-code&environmentId=${environment.id}`,
      );
      expect(fullResponse.status).toBe(200);
      const full = commandListResponseSchema.parse(
        await readJson(fullResponse),
      );
      expect(full.commands.map((command) => command.name)).toEqual([
        "compact",
        "alpha",
        "bravo",
        "charlie",
        "delta",
      ]);
    });
  });
});
