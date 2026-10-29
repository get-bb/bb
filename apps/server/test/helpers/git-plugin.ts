import type {
  HostDaemonOnlineRpcRequestMessage,
} from "@bb/host-daemon-contract";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
  type HostRpcResponder,
} from "./host-rpc.js";
import {
  installTestBuiltinPlugin,
  type RunningTestServer,
} from "./test-app.js";
import type {
  ThreadGitDiffResponse,
  WorkspaceStatus,
} from "bb-plugin-bb--git/contract";

export interface GitHostReads {
  status: WorkspaceStatus;
  diff: ThreadGitDiffResponse;
}

export async function installGitPluginWithHost(
  server: RunningTestServer,
  args: {
    hostId: string;
    sessionId: string;
    reads: GitHostReads;
    handleOther: (
      request: HostDaemonOnlineRpcRequestMessage,
    ) => HostRpcHandlerResult;
  },
): Promise<HostRpcResponder> {
  const responder = registerHostRpcResponder(server, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    handle(request) {
      const { command } = request;
      if (command.type !== "plugin.host.call" || command.pluginId !== "bb--git") {
        return args.handleOther(request);
      }
      switch (command.method) {
        case "status":
          return {
            ok: true,
            result: { output: { outcome: "available", value: args.reads.status } },
          };
        case "diff":
          return {
            ok: true,
            result: { output: { outcome: "available", value: args.reads.diff } },
          };
        default:
          throw new Error(`unexpected git host method ${command.method}`);
      }
    },
  });
  server.pluginService.bindSdk({ baseUrl: server.baseUrl });
  await installTestBuiltinPlugin(server, "git");
  return responder;
}
