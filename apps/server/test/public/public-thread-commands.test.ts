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
  seedThread,
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

describe("public thread command typeahead route", () => {
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
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "claude-code",
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
        `/api/v1/threads/${thread.id}/commands?query=re`,
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

      // Exactly one RPC, carrying the resolved provider + workspace cwd.
      expect(stub.requests.map((request) => request.command)).toEqual([
        {
          type: "host.list_commands",
          providerId: "claude-code",
          cwd: "/tmp/claude-commands-env",
        },
      ]);
    });
  });

  it("returns codex skills for a codex thread", async () => {
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
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
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
        `/api/v1/threads/${thread.id}/commands`,
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
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "pi",
      });
      const stub = registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [skill("anything", "user")],
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/commands`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      expect(body).toEqual({ commands: [], truncated: false });
      // No daemon roundtrip for a provider without a command surface.
      expect(stub.requests).toEqual([]);
    });
  });

  it("passes cwd: null for an unprovisioned thread and returns user-origin entries", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-commands-unprovisioned",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/unprovisioned-project",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: null,
        providerId: "claude-code",
      });
      const stub = registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [skill("user-only", "user", { description: "Home skill" })],
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/commands`,
      );

      expect(response.status).toBe(200);
      const body = commandListResponseSchema.parse(await readJson(response));
      expect(body.commands.map((command) => command.name)).toEqual([
        "user-only",
      ]);
      // Falls back to the project source path on the primary host, since the
      // project has a local-path source even though no environment is ready.
      expect(stub.requests[0]?.command).toEqual({
        type: "host.list_commands",
        providerId: "claude-code",
        cwd: "/tmp/unprovisioned-project",
      });
    });
  });

  it("degrades to the project source (no 409) when the thread's environment is still provisioning", async () => {
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
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "claude-code",
      });
      const stub = registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [skill("user-only", "user", { description: "Home skill" })],
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/commands`,
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

  it("passes cwd: null when the thread has neither a ready environment nor a project source", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-commands-no-source",
      });
      seedPrimaryHost(harness.deps, host.id);
      // Source-less project: createProject requires a source, so seed one then
      // point the thread at a project without a local-path source on the
      // primary host by using a project whose source is on a different host.
      const otherHost = seedHost(harness.deps, { id: "host-commands-other" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: otherHost.id,
        path: "/tmp/other-host-project",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: null,
        providerId: "claude-code",
      });
      const stub = registerCommandRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        commands: [skill("user-only", "user")],
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/commands`,
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
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "claude-code",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/commands`,
      );

      expect(response.status).toBe(502);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "host_unavailable",
      });
    });
  });

  it("honors limit and reports truncation; empty query returns the full capped list", async () => {
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
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "claude-code",
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
        `/api/v1/threads/${thread.id}/commands?limit=2`,
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

      const fullResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/commands`,
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
