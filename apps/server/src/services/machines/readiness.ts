import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  getHost,
  getProjectSourceByHost,
  machineWorkspaceSetups,
} from "@bb/db";
import type { experimental_HostReadinessResponse } from "@bb/server-contract";
import { z } from "zod";
import type { WorkSessionDeps } from "../../types.js";
import {
  callHostOnlineRpc,
  callHostRetryableOnlineRpc,
} from "../hosts/online-rpc.js";
import { resolveBridgeLaunchForProviderId } from "../system/provider-bridge-launch.js";
import {
  ensureProviderInstallation,
  serializeProviderInstallation,
} from "../system/provider-installations.js";
import {
  resolvePluginProviderEnv,
  resolvePluginProviderEnvHealth,
} from "../plugins/plugin-agent-contributions.js";
import {
  getMachineProvider,
  invokeMachineProvider,
} from "../plugins/plugin-machine-provider-registry.js";

const setupSchema = z
  .object({
    scriptText: z.string().max(256 * 1024),
    scriptHash: z.string().min(1),
    cacheManifest: z.json(),
    checks: z.array(z.string().max(16384)).max(32),
  })
  .strict();
const probeSchema = z
  .object({
    serverPath: z.string().startsWith("/").max(4096),
    headers: z.record(z.string(), z.string()),
  })
  .strict();
export async function ensureHostReady(
  deps: WorkSessionDeps,
  args: {
    hostId: string;
    providerId: string;
    projectId: string;
    threadId: string | null;
    path: string | null;
  },
): Promise<experimental_HostReadinessResponse> {
  let stage: "cli" | "auth" | "workspace" = "cli";
  const blocked = (
    code: string,
    message: string,
    retryable = true,
  ): experimental_HostReadinessResponse => ({
    status: "blocked",
    code,
    stage,
    message,
    retryable,
  });
  try {
    const host = getHost(deps.db, args.hostId);
    if (!host || host.destroyedAt)
      return blocked("host_missing", "Machine is unavailable", false);
    const cli = await ensureProviderInstallation(deps, args);
    if (!cli.ready) return blocked("setup_required", cli.message, false);
    stage = "auth";
    const routed = await resolvePluginProviderEnvHealth({
      providerId: args.providerId,
      hostId: args.hostId,
      threadId: args.threadId,
    });
    if (routed) {
      if (args.threadId !== null) {
        const entries = await resolvePluginProviderEnv({
          providerId: args.providerId,
          context: {
            threadId: args.threadId,
            projectId: args.projectId,
            hostId: args.hostId,
          },
        });
        if (entries.length === 0)
          return blocked(
            "credential_route_unavailable",
            "The selected thread has no active credential route",
          );
      }
      if (!routed.experimental_probe)
        return blocked(
          "auth_probe_unavailable",
          "Credential routing does not provide a machine reachability check",
          false,
        );
      const probe = probeSchema.parse(routed.experimental_probe);
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId: args.hostId,
        timeoutMs: 20000,
        command: { type: "host.readiness.probe", ...probe },
      });
      if (!result.reachable)
        return blocked(
          "credential_route_unreachable",
          "The machine cannot authenticate to its credential proxy",
        );
    } else {
      const bridgeLaunch = resolveBridgeLaunchForProviderId(
        deps,
        args.providerId,
      );
      if (!bridgeLaunch)
        return blocked(
          "auth_unavailable",
          "Provider authentication cannot be checked",
          false,
        );
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId: args.hostId,
        timeoutMs: 60000,
        command: {
          type: "provider.health",
          providerId: args.providerId,
          bridgeLaunch,
        },
      });
      if (!result.supported || result.health.status !== "ready")
        return blocked(
          "credentials_required",
          "Configure a usable credential route or authenticate this provider on the machine",
          false,
        );
    }
    stage = "workspace";
    const path =
      args.path ??
      getProjectSourceByHost(deps.db, args.projectId, args.hostId)?.path;
    if (!path)
      return blocked(
        "checkout_required",
        "Prepare this project's checkout on the machine first",
        false,
      );
    return await serializeProviderInstallation<experimental_HostReadinessResponse>(
      deps,
      args.hostId,
      async () => {
        const inspect = () =>
          callHostRetryableOnlineRpc(deps, {
            hostId: args.hostId,
            timeoutMs: 60000,
            command: { type: "workspace.readiness.inspect", path },
          });
        const facts = await inspect();
        const record = host.machineProviderId
          ? getMachineProvider(host.machineProviderId)
          : undefined;
        if (
          record?.provider.experimental_workspaceSetup &&
          host.resource !== null
        ) {
          const callback = record.provider.experimental_workspaceSetup;
          const outcome = await invokeMachineProvider(
            record,
            "workspace setup",
            () =>
              callback({
                hostId: host.id,
                projectId: args.projectId,
                resource: host.resource!,
              }),
          );
          if (!outcome.ok)
            return blocked(
              "setup_unavailable",
              "The machine provider could not resolve its pinned workspace setup",
            );
          if (outcome.value !== null) {
            const setup = setupSchema.parse(outcome.value);
            const stampOf = (input: typeof facts) =>
              createHash("sha256")
                .update(
                  JSON.stringify({ files: input.files, abi: input.abi, setup }),
                )
                .digest("hex");
            const stamp = stampOf(facts);
            const existing = deps.db
              .select()
              .from(machineWorkspaceSetups)
              .where(
                and(
                  eq(machineWorkspaceSetups.hostId, host.id),
                  eq(machineWorkspaceSetups.path, path),
                ),
              )
              .get();
            const run = (script: string) =>
              callHostOnlineRpc(deps, {
                hostId: host.id,
                timeoutMs: 10 * 60 * 1000 + 5000,
                command: {
                  type: "workspace.readiness.run",
                  path,
                  script,
                  env: {},
                  timeoutMs: 10 * 60 * 1000,
                },
              });
            const check = async () => {
              for (const script of setup.checks)
                if ((await run(script)).exitCode !== 0) return false;
              return true;
            };
            if (existing?.stamp !== stamp || !(await check())) {
              if (facts.dirty.length)
                return blocked(
                  "dirty_checkout",
                  "Setup inputs changed in a dirty checkout; review and commit or stash tracked edits before running setup",
                  false,
                );
              if (
                setup.scriptText &&
                (await run(setup.scriptText)).exitCode !== 0
              )
                return blocked(
                  "setup_failed",
                  "The stored workspace setup script failed",
                );
              const after = await inspect();
              if (after.dirty.length || stampOf(after) !== stamp)
                return blocked(
                  "setup_changed_source",
                  "Setup changed tracked inputs; review the checkout before continuing",
                  false,
                );
              if (!(await check()))
                return blocked(
                  "dependency_check_failed",
                  "Workspace dependency checks failed after setup",
                );
              deps.db
                .insert(machineWorkspaceSetups)
                .values({ hostId: host.id, path, stamp, updatedAt: Date.now() })
                .onConflictDoUpdate({
                  target: [
                    machineWorkspaceSetups.hostId,
                    machineWorkspaceSetups.path,
                  ],
                  set: { stamp, updatedAt: Date.now() },
                })
                .run();
            }
          }
        }
        return {
          status: "ready",
          checks: [
            { kind: "cli", status: "passed" },
            { kind: "auth", status: "passed" },
            { kind: "workspace", status: "passed" },
          ],
        };
      },
    );
  } catch {
    return blocked(
      `${stage}_unavailable`,
      `Machine ${stage} readiness could not be completed; check the machine connection and configuration`,
    );
  }
}
