import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import type { z } from "zod";
import {
  devServersContract,
  devServersHostContract,
  serversTag,
  type DevServer,
  type HostDevServer,
} from "./contract.js";

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

type ListResult = z.infer<
  (typeof devServersContract)["servers.list"]["output"]
>;

const EMPTY_LIST_MESSAGES = {
  ok: "No servers are running.",
  "no-environment": "The thread has no environment, so it has no servers.",
  offline: "The machine of the thread is offline.",
  unsupported: "This machine's platform does not support listing servers.",
} as const;

function describePorts(server: DevServer): string {
  return server.ports.map((port) => `${port.address}:${port.port}`).join(", ");
}

function textServer(server: HostDevServer): string {
  return `${server.threadId}\t${server.rootPid}\t${describePorts(server)}\t${server.command ?? "?"}`;
}

export default async function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({
    contract: devServersHostContract,
  });

  async function threadHost(
    threadId: string,
  ): Promise<{ id: string; name: string; connected: boolean } | null> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.environmentId === null) return null;
    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    const hosts = await bb.sdk.hosts.list();
    const match = hosts.find(
      (candidate) => candidate.id === environment.hostId,
    );
    return {
      id: environment.hostId,
      name: match?.name ?? environment.hostId,
      connected: match?.status === "connected",
    };
  }

  async function listForThread(threadId: string): Promise<ListResult> {
    const target = await threadHost(threadId);
    if (target === null) return { status: "no-environment", servers: [] };
    if (!target.connected) return { status: "offline", servers: [] };
    const result = await host.call(
      "list",
      { threadId },
      { hostId: target.id, timeoutMs: 10_000 },
    );
    if (!result.supported) return { status: "unsupported", servers: [] };
    const primaryHost =
      (await bb.sdk.system.config()).primaryHostId === target.id;
    return {
      status: "ok",
      servers: result.servers.map((server) => ({
        ...server,
        hostId: target.id,
        hostName: target.name,
        primaryHost,
      })),
    };
  }

  async function listEverywhere(): Promise<HostDevServer[]> {
    const hosts = (await bb.sdk.hosts.list()).filter(
      (candidate) => candidate.status === "connected",
    );
    const { primaryHostId } = await bb.sdk.system.config();
    const perHost = await Promise.all(
      hosts.map(async (candidate) => {
        try {
          const result = await host.call(
            "list",
            { threadId: null },
            { hostId: candidate.id, timeoutMs: 10_000 },
          );
          return result.servers.map((server) => ({
            ...server,
            hostId: candidate.id,
            hostName: candidate.name,
            primaryHost: candidate.id === primaryHostId,
          }));
        } catch (error) {
          bb.log.warn(
            `Could not list servers on ${candidate.name}: ${String(error)}`,
          );
          return [];
        }
      }),
    );
    const servers = perHost.flat();
    const threadIds = [...new Set(servers.map((server) => server.threadId))];
    const known = new Set<string>();
    await Promise.all(
      threadIds.map(async (threadId) => {
        try {
          const thread = await bb.sdk.threads.get({ threadId });
          if (thread.deletedAt === null) known.add(threadId);
        } catch {
          return;
        }
      }),
    );
    return servers.filter((server) => known.has(server.threadId));
  }

  async function stop(args: {
    threadId: string;
    rootPid: number;
    startedAt: number | null | "listed";
  }): Promise<{ stopped: boolean }> {
    const listed = await listForThread(args.threadId);
    const server = listed.servers.find(
      (candidate) => candidate.rootPid === args.rootPid,
    );
    if (server === undefined) return { stopped: false };
    const result = await host.call(
      "stop",
      {
        threadId: args.threadId,
        rootPid: args.rootPid,
        startedAt:
          args.startedAt === "listed" ? server.startedAt : args.startedAt,
      },
      { hostId: server.hostId, timeoutMs: 15_000 },
    );
    bb.rpc.experimental_invalidate([serversTag(args.threadId)]);
    return result;
  }

  bb.rpc.register(devServersContract, {
    "servers.list": ({ threadId }) => listForThread(threadId),
    "servers.stop": (input) => stop(input),
  });

  const refresh = (threadId: string) =>
    bb.rpc.experimental_invalidate([serversTag(threadId)]);
  bb.events.on("experimental_thread.settled", ({ thread }) =>
    refresh(thread.id),
  );
  bb.events.on("thread.active", ({ thread }) => refresh(thread.id));

  bb.cli.register(
    defineCli({
      name: "dev-servers",
      summary: "List and stop the servers that threads started",
      description:
        "A server is a process that listens on a TCP port and that a thread's agent started from its shell. Stop ends the command that started it and every process under that command.",
      usageErrorExitCode: 2,
      commands: {
        list: cliCommand({
          summary: "List the servers a thread started",
          positionals: [
            {
              name: "thread-id",
              description:
                "Thread to list; defaults to this thread, and lists every thread on every connected machine outside one",
            },
          ],
          options: { json: JSON_OPTION },
          async run(input, context) {
            const threadId =
              input.positionals["thread-id"] ?? context.threadId ?? null;
            const { status, servers } =
              threadId === null
                ? { status: "ok" as const, servers: await listEverywhere() }
                : await listForThread(threadId);
            if (input.options.json)
              return {
                exitCode: 0,
                stdout: `${JSON.stringify({ status, servers }, null, 2)}\n`,
              };
            return {
              exitCode: 0,
              stdout:
                servers.length > 0
                  ? `${servers.map(textServer).join("\n")}\n`
                  : `${EMPTY_LIST_MESSAGES[status]}\n`,
            };
          },
        }),
        stop: cliCommand({
          summary: "Stop a server a thread started",
          positionals: [
            {
              name: "pid",
              description:
                "Process id of the server's command, from `bb dev-servers list`",
              required: true,
            },
          ],
          options: {
            json: JSON_OPTION,
            thread: {
              type: "string",
              description:
                "Thread that started the server; defaults to this thread",
            },
          },
          async run(input, context) {
            const threadId = input.options.thread ?? context.threadId;
            if (threadId === undefined)
              throw new PluginCliError(
                "A thread id is required: bb dev-servers stop <pid> --thread <thread-id>",
                { code: "missing_thread_id", exitCode: 2 },
              );
            const rootPid = Number(input.positionals.pid);
            if (!Number.isInteger(rootPid) || rootPid <= 0)
              throw new PluginCliError(
                `Not a process id: ${input.positionals.pid}`,
                {
                  code: "invalid_pid",
                  exitCode: 2,
                },
              );
            const result = await stop({
              threadId,
              rootPid,
              startedAt: "listed",
            });
            if (!result.stopped)
              throw new PluginCliError(
                `${threadId} has no server with process id ${rootPid}.`,
                {
                  code: "no_server",
                  hint: "Run `bb dev-servers list` for the servers of the thread.",
                },
              );
            return {
              exitCode: 0,
              stdout: input.options.json
                ? `${JSON.stringify({ ok: true, threadId, rootPid }, null, 2)}\n`
                : `Stopped ${rootPid}.\n`,
            };
          },
        }),
      },
    }),
  );
}
