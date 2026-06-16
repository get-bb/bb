import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
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
}

interface RegisterCommandRpcArgs {
  hostId: string;
  sessionId: string;
  commands: HostProviderCommand[];
}

/**
 * Mocks the host online-RPC boundary for `host.list_commands` only: returns the
 * supplied raw command set and records every request so tests can assert what
 * `cwd`/`providerId` the server sent. All other RPC types fail loudly so an
 * unexpected daemon call surfaces instead of silently passing.
 */
function registerCommandRpc(
  harness: Parameters<typeof registerHostRpcResponder>[0],
  args: RegisterCommandRpcArgs,
): CommandRpcStub {
  const stub: CommandRpcStub = { commands: args.commands, requests: [] };
  const responder = registerHostRpcResponder(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    handle: (request) => {
      if (request.command.type !== "host.list_commands") {
        throw new Error(
          `Unexpected RPC command ${request.command.type} in command typeahead test`,
        );
      }
      return { ok: true, result: { commands: stub.commands } };
    },
  });
  stub.requests = responder.requests;
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
  it("filters, sorts, and de-dupes claude-code commands with project winning over user", async () => {
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
        `/api/v1/projects/${project.id}/commands?provider=claude-code&environmentId=${environment.id}&query=re`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      // query "re": names review/refactor match; deploy does not. Section rank
      // is primary (skills before legacy commands), then within a section the
      // prefix-then-alphabetical order: skills `refactor` < `review`, then the
      // `command`-source `review`. The (skill review) collision keeps the
      // project-origin entry over the user-origin one, while the cross-source
      // (command review) is retained as a distinct invocation.
      expect(body.commands).toEqual([
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
      expect(body.truncated).toBe(false);

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
        "prd",
        "skill-installer",
      ]);
      expect(body.truncated).toBe(false);
      expect(stub.requests[0]?.command).toEqual({
        type: "host.list_commands",
        providerId: "codex",
        cwd: "/tmp/codex-commands-env",
      });
    });
  });

  it("returns an empty list without an RPC for a provider with no command surface", async () => {
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
      });
      const stub = registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [skill("anything", "user")],
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=pi&environmentId=${environment.id}`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      expect(body).toEqual({ commands: [], truncated: false });
      // No daemon roundtrip for a provider without a command surface.
      expect(stub.requests).toEqual([]);
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

  it("honors limit, offset, and reports truncation; empty query returns the full capped list", async () => {
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

      const limitedResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=claude-code&environmentId=${environment.id}&limit=2`,
      );
      expect(limitedResponse.status).toBe(200);
      const limited = commandListResponseSchema.parse(
        await readJson(limitedResponse),
      );
      expect(limited.commands.map((command) => command.name)).toEqual([
        "alpha",
        "bravo",
      ]);
      expect(limited.truncated).toBe(true);

      const nextPageResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=claude-code&environmentId=${environment.id}&limit=2&offset=2`,
      );
      expect(nextPageResponse.status).toBe(200);
      const nextPage = commandListResponseSchema.parse(
        await readJson(nextPageResponse),
      );
      expect(nextPage.commands.map((command) => command.name)).toEqual([
        "charlie",
        "delta",
      ]);
      expect(nextPage.truncated).toBe(false);

      const fullResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=claude-code&environmentId=${environment.id}`,
      );
      expect(fullResponse.status).toBe(200);
      const full = commandListResponseSchema.parse(
        await readJson(fullResponse),
      );
      expect(full.commands.map((command) => command.name)).toEqual([
        "alpha",
        "bravo",
        "charlie",
        "delta",
      ]);
      expect(full.truncated).toBe(false);
    });
  });
});
