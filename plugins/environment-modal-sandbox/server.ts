import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type {
  PluginMachineProviderCreateContext,
  PluginMachineProviderCreateResult,
  PluginMachineProviderProgress,
} from "@get-bb/plugin-sdk/machine-provider";
import {
  createTerminalOutputLineReader,
  readTerminalOutputLines,
} from "bb-environment-provider-host/terminal-output";
import {
  resolveSettings,
  SETTING_DESCRIPTORS,
  type ResolvedSettings,
} from "./configuration.js";
import {
  prerequisitesScript,
  providerAuthenticationScript,
  projectClonePath,
  shellCommand,
  shellQuote,
} from "./sandbox-setup.js";
import {
  createModalBackend,
  createSandboxExecutor,
  type SandboxBackend,
  type SandboxBackendFactory,
  type SandboxHandle,
} from "./sandbox-backend.js";
import {
  readModalMachineResource,
  type ModalMachineResource,
} from "./lifecycle.js";

export const PROVIDER_ID = "modal-sandbox";

const HOST_CONNECT_TIMEOUT_MS = 240_000;
const HOST_POLL_INTERVAL_MS = 3_000;
const DAEMON_STOP_TIMEOUT_MS = 60_000;
const PREREQUISITES_TIMEOUT_MS = 300_000;
const PROVIDER_AUTHENTICATION_TIMEOUT_MS = 120_000;
const CLONE_TIMEOUT_MS = 900_000;
const SNAPSHOT_TIMEOUT_MS = 300_000;
const REMOVE_RETRY_MS = 30_000;
const RETIRE_GRACE_MS = 30 * 24 * 60 * 60_000;
const DEFAULT_IDLE_MS = 15 * 60_000;
const FAILURE_TAIL_LINES = 12;
const FAILURE_TAIL_MAX_CHARS = 2_000;
type ProvisionProject = NonNullable<
  PluginMachineProviderCreateContext["project"]
>;

class LaunchAbortedError extends Error {}
class LaunchTerminalError extends Error {}

const TERMINAL_LAUNCH_FAILURE_PATTERN =
  /authentication failed|could not read username|could not read from remote repository|host key verification failed|permission denied \(publickey\)|repository not found|installer returned HTTP status 4\d\d/iu;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportTerminalOutput(
  report: PluginMachineProviderProgress,
  output: string,
): void {
  const lines = readTerminalOutputLines(output);
  if (lines.length > 0) report.log(lines.join("\n"));
}

export interface ModalSandboxDeps {
  backendFactory: SandboxBackendFactory;
  now: () => number;
  sleep: (delayMs: number) => Promise<void>;
}

export function createModalSandboxPlugin(
  deps: ModalSandboxDeps,
): (bb: BbPluginApi) => Promise<void> {
  return async (bb) => {
    const settings = bb.settings.define(SETTING_DESCRIPTORS);
    let cachedBackend: { token: string; backend: SandboxBackend } | null = null;

    async function currentSettings(): Promise<
      { ok: true; settings: ResolvedSettings } | { ok: false; message: string }
    > {
      return resolveSettings(await settings.get());
    }

    function backendFor(resolved: ResolvedSettings): SandboxBackend {
      const token = `${resolved.tokenId}:${resolved.tokenSecret}`;
      if (cachedBackend?.token === token) return cachedBackend.backend;
      const backend = deps.backendFactory({
        tokenId: resolved.tokenId,
        tokenSecret: resolved.tokenSecret,
      });
      cachedBackend = { token, backend };
      return backend;
    }

    function guard(signal: AbortSignal): void {
      if (signal.aborted) throw new LaunchAbortedError("cancelled");
    }

    async function run(args: {
      sandbox: SandboxHandle;
      script: string;
      timeoutMs: number;
      what: string;
      report: PluginMachineProviderProgress;
      signal: AbortSignal;
    }) {
      const result = await args.sandbox.exec(shellCommand(args.script), {
        timeoutMs: args.timeoutMs,
        signal: args.signal,
      });
      const output = `${result.stdout}\n${result.stderr}`;
      reportTerminalOutput(args.report, output);
      if (result.exitCode !== 0) {
        const tail = readTerminalOutputLines(output)
          .slice(-FAILURE_TAIL_LINES)
          .join(" / ");
        const detail =
          tail.length > FAILURE_TAIL_MAX_CHARS
            ? `…${tail.slice(-FAILURE_TAIL_MAX_CHARS)}`
            : tail;
        throw new Error(
          detail.length === 0
            ? `${args.what} exited ${result.exitCode}`
            : `${args.what} exited ${result.exitCode}: ${detail}`,
        );
      }
      return result;
    }

    async function waitForHostDisconnection(
      hostId: string,
      signal: AbortSignal,
    ): Promise<void> {
      const deadline = deps.now() + HOST_CONNECT_TIMEOUT_MS;
      for (;;) {
        guard(signal);
        const host = (await bb.sdk.hosts.list()).find(
          (candidate) => candidate.id === hostId,
        );
        if (host?.status !== "connected") return;
        if (deps.now() >= deadline) {
          throw new Error(`host ${hostId} remained connected after suspension`);
        }
        await deps.sleep(HOST_POLL_INTERVAL_MS);
      }
    }

    async function providerCliStatusesWhenConnected(args: {
      hostId: string;
      signal: AbortSignal;
    }) {
      const deadline = deps.now() + HOST_CONNECT_TIMEOUT_MS;
      for (;;) {
        guard(args.signal);
        try {
          return await bb.sdk.hosts.providerCliStatus({
            hostId: args.hostId,
          });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !/host is not connected/iu.test(error.message) ||
            deps.now() >= deadline
          ) {
            throw error;
          }
        }
        await deps.sleep(HOST_POLL_INTERVAL_MS);
      }
    }

    async function ensureCodexReady(args: {
      hostId: string;
      sandbox: SandboxHandle;
      environmentVariables: Readonly<Record<string, string>>;
      report: PluginMachineProviderProgress;
      signal: AbortSignal;
    }): Promise<void> {
      const statuses = await providerCliStatusesWhenConnected(args);
      const status = statuses.codex;
      const action = status?.installAction;
      if (status !== undefined && action !== null) {
        const actionVerb =
          action.kind === "install" ? "Installing" : "Updating";
        args.report.step(`${actionVerb} ${status.displayName}…`);
        const events = await bb.sdk.hosts.installProviderCli({
          hostId: args.hostId,
          provider: "codex",
          actionKind: action.kind,
        });
        const outputReader = createTerminalOutputLineReader();
        for (const event of events) {
          if (event.type === "started") {
            args.report.log(`$ ${event.command}\n`);
          } else if (event.type === "output") {
            const lines = outputReader.push(event.text);
            if (lines.length > 0) args.report.log(lines.join("\n"));
          }
        }
        const remainingLines = outputReader.flush();
        if (remainingLines.length > 0) {
          args.report.log(remainingLines.join("\n"));
        }
        const completed = events.find((event) => event.type === "completed");
        if (completed?.success !== true) {
          const failure = events.find((event) => event.type === "error");
          throw new Error(
            failure?.type === "error"
              ? failure.message
              : `${actionVerb.toLowerCase()} ${status.displayName} failed`,
          );
        }
      }
      const authenticationScript = providerAuthenticationScript(
        "codex",
        args.environmentVariables,
      );
      if (authenticationScript !== null) {
        args.report.step("Authenticating Codex…");
        await run({
          sandbox: args.sandbox,
          script: authenticationScript,
          timeoutMs: PROVIDER_AUTHENTICATION_TIMEOUT_MS,
          what: "authenticating Codex",
          report: args.report,
          signal: args.signal,
        });
      }
      const states = await bb.sdk.system.providerStates({
        hostId: args.hostId,
      });
      const state = states.providers.find(
        (candidate) => candidate.providerId === "codex",
      );
      if (
        state === undefined ||
        state.status === "ready" ||
        state.status === "unknown"
      ) {
        return;
      }
      if (state.status === "unauthenticated" || state.status === "expired") {
        throw new LaunchTerminalError(
          `${state.displayName} is ${state.status} in the new sandbox. Add OPENAI_API_KEY or CODEX_ACCESS_TOKEN to the Modal plugin's environmentVariables JSON setting, or use an image whose root user already has a valid Codex login.`,
        );
      }
      throw new LaunchTerminalError(
        state.statusMessage ??
          `${state.displayName} is not ready in the new sandbox (${state.status}).`,
      );
    }

    async function ensureProjectSource(args: {
      hostId: string;
      project: ProvisionProject;
      gitRemote: string;
      sandbox: SandboxHandle;
      report: PluginMachineProviderProgress;
      signal: AbortSignal;
    }): Promise<string> {
      const path = projectClonePath(args.project.name);
      args.report.step(`Cloning ${args.project.name}…`);
      await run({
        sandbox: args.sandbox,
        script: [
          "set -eu",
          `mkdir -p ${shellQuote("/workspace")}`,
          `if [ -d ${shellQuote(`${path}/.git`)} ]; then`,
          `  echo ${shellQuote(`clone already present at ${path}`)}`,
          "else",
          `  git clone --progress ${shellQuote(args.gitRemote)} ${shellQuote(path)}`,
          "fi",
        ].join("\n"),
        timeoutMs: CLONE_TIMEOUT_MS,
        what: `cloning ${args.project.name}`,
        report: args.report,
        signal: args.signal,
      });
      guard(args.signal);
      const project = await bb.sdk.projects.get({
        projectId: args.project.id,
      });
      const existing = project.sources.find(
        (source) => source.hostId === args.hostId && source.path === path,
      );
      if (existing !== undefined) return existing.id;
      args.report.step("Registering the project checkout…");
      const source = await bb.sdk.projects.sources.add({
        projectId: args.project.id,
        hostId: args.hostId,
        type: "local_path",
        path,
      });
      return source.id;
    }

    async function launch(
      context: PluginMachineProviderCreateContext,
    ): Promise<PluginMachineProviderCreateResult> {
      const resolved = await currentSettings();
      if (!resolved.ok) {
        return {
          status: "failed",
          failure: "terminal",
          message: resolved.message,
        };
      }
      if (context.project !== null && context.project.gitRemoteUrl === null) {
        return {
          status: "failed",
          failure: "terminal",
          message: `${context.project.name} has no git remote.`,
        };
      }
      const backend = backendFor(resolved.settings);
      try {
        guard(context.signal);
        await bb.experimental_machines.prepareEnrollment({ key: context.key });
        guard(context.signal);
        let sandbox = await backend.fromName(
          resolved.settings.appName,
          context.key,
        );
        if (sandbox === null) {
          context.report.step("Creating the Modal sandbox…");
          sandbox = await backend.create({
            appName: resolved.settings.appName,
            name: context.key,
            image: { type: "registry", reference: resolved.settings.image },
            environmentVariables: resolved.settings.environmentVariables,
            timeoutMs: resolved.settings.timeoutMs,
            cpu: resolved.settings.cpu,
            memoryMiB: resolved.settings.memoryMiB,
            tags:
              context.project === null
                ? { bbMachineKey: context.key }
                : {
                    bbMachineKey: context.key,
                    bbProjectId: context.project.id,
                  },
          });
        }
        const allocation: ModalMachineResource = {
          version: 3,
          key: context.key,
          sandboxId: sandbox.sandboxId,
          snapshotImageId: null,
          pendingSnapshotImageIds: [],
          projectId: context.project?.id ?? null,
          sourceId: null,
        };
        await context.checkpoint(allocation);
        guard(context.signal);
        context.report.step("Installing prerequisites…");
        await run({
          sandbox,
          script: prerequisitesScript(),
          timeoutMs: PREREQUISITES_TIMEOUT_MS,
          what: "installing prerequisites",
          signal: context.signal,
          report: context.report,
        });
        const { hostId } = await bb.experimental_machines.bootstrap({
          key: context.key,
          executor: createSandboxExecutor(sandbox),
          daemon: { kind: "install" },
          report: context.report,
          signal: context.signal,
        });
        await ensureCodexReady({
          hostId,
          sandbox,
          environmentVariables: resolved.settings.environmentVariables,
          report: context.report,
          signal: context.signal,
        });
        const sourceId =
          context.project === null || context.project.gitRemoteUrl === null
            ? null
            : await ensureProjectSource({
                hostId,
                project: context.project,
                gitRemote: context.project.gitRemoteUrl,
                sandbox,
                report: context.report,
                signal: context.signal,
              });
        const resource = { ...allocation, sourceId };
        if (sourceId !== null) await context.checkpoint(resource);
        guard(context.signal);
        return { status: "created", hostId, resource };
      } catch (error) {
        if (context.signal.aborted || error instanceof LaunchAbortedError) {
          throw error;
        }
        const message = errorMessage(error);
        const terminal =
          error instanceof LaunchTerminalError ||
          TERMINAL_LAUNCH_FAILURE_PATTERN.test(message);
        return {
          status: "failed",
          failure: terminal ? "terminal" : "transient",
          message,
        };
      }
    }

    async function findSandbox(
      resource: ModalMachineResource,
      resolved: ResolvedSettings,
    ): Promise<SandboxHandle | null> {
      if (resource.sandboxId !== null) {
        const byId = await backendFor(resolved).fromId(resource.sandboxId);
        if (byId !== null) return byId;
      }
      return backendFor(resolved).fromName(resolved.appName, resource.key);
    }

    async function deletePendingSnapshots(
      resource: ModalMachineResource,
      resolved: ResolvedSettings,
      checkpoint?: (resource: ModalMachineResource) => void,
    ): Promise<ModalMachineResource> {
      let current = resource;
      for (const imageId of resource.pendingSnapshotImageIds) {
        if (imageId === resource.snapshotImageId) continue;
        await backendFor(resolved).deleteSnapshot(imageId);
        current = {
          ...current,
          pendingSnapshotImageIds: current.pendingSnapshotImageIds.filter(
            (candidate) => candidate !== imageId,
          ),
        };
        checkpoint?.(current);
      }
      return current;
    }

    const configuredAtRegistration = await currentSettings();
    bb.experimental_machines.register({
      id: PROVIDER_ID,
      displayName: "Modal sandbox",
      icon: "./modal-logo.svg",
      requires: { gitRemote: true },
      environmentRow: {
        displayName: "Modal sandbox",
        environmentProviderId: "project-checkout",
      },
      policy: {
        idleSuspendMs: configuredAtRegistration.ok
          ? configuredAtRegistration.settings.idleMs
          : DEFAULT_IDLE_MS,
        retire: { after: "last-thread", graceMs: RETIRE_GRACE_MS },
        removeRetryMs: REMOVE_RETRY_MS,
      },
      async availability({ project }) {
        const resolved = await currentSettings();
        if (!resolved.ok) {
          return { status: "setup-required", message: resolved.message };
        }
        return project !== null && project.gitRemoteUrl === null
          ? {
              status: "unavailable",
              message: `${project.name} has no git remote.`,
            }
          : { status: "available" };
      },
      async validate({ project }) {
        return project !== null && project.gitRemoteUrl === null
          ? { action: "refuse", message: `${project.name} has no git remote.` }
          : { action: "accept" };
      },
      create: launch,
      async suspend(context) {
        const resource = readModalMachineResource(context.resource);
        const resolved = await currentSettings();
        if (!resolved.ok) throw new Error(resolved.message);
        const sandbox = await findSandbox(resource, resolved.settings);
        if (sandbox === null) {
          if (resource.snapshotImageId === null) {
            throw new Error("The Modal sandbox has no restorable snapshot.");
          }
          return {
            resource: await deletePendingSnapshots(
              resource,
              resolved.settings,
              context.checkpoint,
            ),
          };
        }
        context.report.step("Stopping the bb machine…");
        await run({
          sandbox,
          script: `bb_bin=$(command -v bb || true); if [ -z "$bb_bin" ]; then bb_bin="$HOME/.local/bin/bb"; fi; exec "$bb_bin" machine stop --host-id ${shellQuote(context.hostId)}`,
          timeoutMs: DAEMON_STOP_TIMEOUT_MS,
          signal: context.signal,
          what: "stopping the bb machine",
          report: context.report,
        });
        await waitForHostDisconnection(context.hostId, context.signal);
        context.report.step("Saving the Modal filesystem…");
        const snapshotImageId = await sandbox.snapshotFilesystem({
          timeoutMs: SNAPSHOT_TIMEOUT_MS,
          ttlMs: null,
        });
        const checkpoint = {
          ...resource,
          snapshotImageId,
          pendingSnapshotImageIds: [
            ...new Set([
              ...resource.pendingSnapshotImageIds,
              ...(resource.snapshotImageId === null ||
              resource.snapshotImageId === snapshotImageId
                ? []
                : [resource.snapshotImageId]),
            ]),
          ],
        } satisfies ModalMachineResource;
        context.checkpoint(checkpoint);
        await sandbox.terminate();
        const suspended = { ...checkpoint, sandboxId: null };
        context.checkpoint(suspended);
        return {
          resource: await deletePendingSnapshots(
            suspended,
            resolved.settings,
            context.checkpoint,
          ),
        };
      },
      async resume(context) {
        let resource = readModalMachineResource(context.resource);
        const resolved = await currentSettings();
        if (!resolved.ok) throw new Error(resolved.message);
        resource = await deletePendingSnapshots(resource, resolved.settings);
        let sandbox = await findSandbox(resource, resolved.settings);
        if (sandbox === null) {
          if (resource.snapshotImageId === null) {
            throw new Error("The Modal sandbox has no restorable snapshot.");
          }
          context.report.step("Restoring the Modal sandbox…");
          sandbox = await backendFor(resolved.settings).create({
            appName: resolved.settings.appName,
            name: resource.key,
            image: {
              type: "snapshot",
              imageId: resource.snapshotImageId,
            },
            environmentVariables: resolved.settings.environmentVariables,
            timeoutMs: resolved.settings.timeoutMs,
            cpu: resolved.settings.cpu,
            memoryMiB: resolved.settings.memoryMiB,
            tags:
              resource.projectId === null
                ? { bbMachineKey: resource.key }
                : {
                    bbMachineKey: resource.key,
                    bbProjectId: resource.projectId,
                  },
          });
        }
        const { hostId } = await bb.experimental_machines.bootstrap({
          key: resource.key,
          executor: createSandboxExecutor(sandbox),
          daemon: { kind: "preinstalled" },
          report: context.report,
          signal: context.signal,
        });
        if (hostId !== context.hostId) {
          throw new Error(
            "Modal bootstrap returned a different machine identity.",
          );
        }
        return {
          resource: { ...resource, sandboxId: sandbox.sandboxId },
        };
      },
      async remove(context) {
        const resource = readModalMachineResource(context.resource);
        const resolved = await currentSettings();
        if (!resolved.ok)
          return { status: "failed", message: resolved.message };
        try {
          const sandbox = await findSandbox(resource, resolved.settings);
          await sandbox?.terminate();
          const snapshots = new Set(resource.pendingSnapshotImageIds);
          if (resource.snapshotImageId !== null) {
            snapshots.add(resource.snapshotImageId);
          }
          for (const imageId of snapshots) {
            await backendFor(resolved.settings).deleteSnapshot(imageId);
          }
          if (resource.projectId !== null && resource.sourceId !== null) {
            await bb.sdk.projects.sources
              .delete({
                projectId: resource.projectId,
                sourceId: resource.sourceId,
              })
              .catch((error) => {
                if (!/404|not found|unavailable/iu.test(errorMessage(error))) {
                  throw error;
                }
              });
          }
          return { status: "removed" };
        } catch (error) {
          return { status: "failed", message: errorMessage(error) };
        }
      },
    });

    const loaded = await currentSettings();
    if (!loaded.ok) bb.status.needsConfiguration(loaded.message);
  };
}

export default createModalSandboxPlugin({
  backendFactory: createModalBackend,
  now: () => Date.now(),
  sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
});
