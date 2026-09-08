import type { HostDaemonContributedEnvEntry } from "@bb/host-daemon-contract";
import {
  resolveHostEnvironment,
  mergeHostAndProviderEnvironment,
} from "../hosts/host-environment.js";
import { runMachineRestoreSetup } from "./restore-setup.js";
import { and, eq } from "drizzle-orm";
import {
  getHost,
  getProjectSourceByHost,
  environments,
  environmentSetupOutcomes,
  projectSourceOwnsPath,
} from "@bb/db";
import type { experimental_HostReadinessResponse } from "@bb/server-contract";
import { z } from "zod";
import type { WorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { resolveBridgeLaunchForProviderId } from "../system/provider-bridge-launch.js";
import { ensureProviderInstallation } from "../system/provider-installations.js";
import {
  resolvePluginProviderEnv,
  resolvePluginProviderEnvHealth,
} from "../plugins/plugin-agent-contributions.js";
import {
  environmentSetupInputHash,
  reconcileLegacyEnvironmentSetupOutcome,
} from "../environments/setup-outcomes.js";

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
    contributedEnv?: HostDaemonContributedEnvEntry[];
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
      const contributedEnv =
        args.contributedEnv ??
        mergeHostAndProviderEnvironment(
          await resolveHostEnvironment(deps, args),
          args.threadId === null
            ? []
            : await resolvePluginProviderEnv({
                providerId: args.providerId,
                context: {
                  threadId: args.threadId,
                  projectId: args.projectId,
                  hostId: args.hostId,
                },
              }),
        );
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId: args.hostId,
        timeoutMs: 60000,
        command: {
          type: "provider.health",
          contributedEnv,
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
    await runMachineRestoreSetup(deps, args.hostId);
    const path =
      args.path ??
      getProjectSourceByHost(deps.db, args.projectId, args.hostId)?.path;
    if (!path)
      return blocked(
        "checkout_required",
        "Prepare this project's checkout on the machine first",
        false,
      );
    const environment = deps.db
      .select({ ownsPath: environments.providerOwnsPath })
      .from(environments)
      .where(
        and(
          eq(environments.projectId, args.projectId),
          eq(environments.hostId, args.hostId),
          eq(environments.path, path),
          eq(environments.status, "ready"),
        ),
      )
      .limit(1)
      .get();
    const ownsPath =
      environment?.ownsPath ??
      projectSourceOwnsPath(deps.db, args.projectId, args.hostId, path);
    if (ownsPath) {
      await reconcileLegacyEnvironmentSetupOutcome(deps, {
        hostId: args.hostId,
        path,
      });
      const outcome = deps.db
        .select()
        .from(environmentSetupOutcomes)
        .where(
          and(
            eq(environmentSetupOutcomes.hostId, args.hostId),
            eq(environmentSetupOutcomes.path, path),
          ),
        )
        .get();
      if (!outcome || outcome.state === "running")
        return blocked(
          "setup_required",
          "The core environment setup hook has not completed for this checkout",
        );
      if (outcome.state === "failed")
        return blocked(
          "setup_failed",
          "The core environment setup hook failed or changed its tracked inputs; review the environment launch",
        );
      const facts = await callHostRetryableOnlineRpc(deps, {
        hostId: args.hostId,
        timeoutMs: 60000,
        command: { type: "workspace.readiness.inspect", path },
      });
      if (environmentSetupInputHash(facts) !== outcome.inputHash)
        return blocked(
          "dirty" in facts && facts.dirty.length
            ? "dirty_checkout"
            : "setup_stale",
          "Checkout commit, lockfiles, setup hook or ABI changed since core setup succeeded; review the checkout and recreate its owned environment",
          false,
        );
    }
    return {
      status: "ready",
      checks: [
        { kind: "cli", status: "passed" },
        { kind: "auth", status: "passed" },
        { kind: "workspace", status: "passed" },
      ],
    };
  } catch {
    return blocked(
      `${stage}_unavailable`,
      `Machine ${stage} readiness could not be completed; check the machine connection and configuration`,
    );
  }
}
