import { createHarness as createDaemonHarness } from "../../../../apps/host-daemon/test/command/dispatch-helpers.js";
import { RuntimeManager } from "../../../../apps/host-daemon/src/runtime-manager.js";
import { it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  hosts,
  createEnvironment,
  environmentHookOperations,
  environmentSetupOutcomes,
} from "@bb/db";
import { withTestHarness } from "../../../../apps/server/test/helpers/test-app.js";
import {
  seedHostSession,
  seedProjectWithSource,
} from "../../../../apps/server/test/helpers/seed.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../../../../apps/server/test/helpers/host-rpc.js";
import { ensureHostReady } from "../../../../apps/server/src/services/machines/readiness.js";
import { runEnvironmentHook } from "../../../../apps/server/src/services/environments/environment-hooks.js";
import { runEnvironmentHook as daemonHook } from "../../../../apps/host-daemon/src/command-handlers/environment-hook.js";
import { inspectReadiness } from "../../../../apps/host-daemon/src/command-handlers/readiness.js";
import {
  updateMachineEnvironment,
  resolveUserMachineEnvironment,
} from "../../../../apps/server/src/services/machines/environment-settings.js";
import { setPluginAgentContributions } from "../../../../apps/server/src/services/plugins/plugin-agent-contributions.js";

it.each(["personal", "legacy", "legacy-completed", "machine-auth"])(
  "proves %s integration behavior with a migrated database",
  async (scenario) => {
    await withTestHarness(async (h) => {
      const { host, session } = seedHostSession(h.deps);
      const { project } = seedProjectWithSource(h.deps, { hostId: host.id });
      h.db
        .update(hosts)
        .set({ machineProviderId: "manual", resource: {} })
        .where(eq(hosts.id, host.id))
        .run();
      const path = join(h.deps.config.dataDir, scenario);
      await mkdir(path);
      if (scenario.startsWith("legacy")) {
        execFileSync("git", ["init", "-q", path]);
        execFileSync("git", [
          "-C",
          path,
          "-c",
          "user.name=Review",
          "-c",
          "user.email=review@example.test",
          "commit",
          "--allow-empty",
          "-qm",
          "initial",
        ]);
      }
      createEnvironment(h.db, h.hub, {
        projectId: project.id,
        hostId: host.id,
        path,
        status: "ready",
        providerOwnsPath: scenario !== "machine-auth",
        environmentProvider: null,
      });
      await mkdir(join(h.deps.config.dataDir, "review-bin"));
      await writeFile(
        join(h.deps.config.dataDir, "review-bin", "gh"),
        "#!/bin/sh\nexit 1\n",
        { mode: 0o700 },
      );
      vi.stubEnv(
        "PATH",
        join(h.deps.config.dataDir, "review-bin") + ":" + process.env.PATH,
      );
      const runtimeManager = new RuntimeManager({
        shellEnv: { PATH: process.env.PATH ?? "" },
      });
      let actualHookRuns = 0;
      let healthCommand: unknown;
      setPluginAgentContributions({
        listSkillRootContributions: () => [],
        listAgentTools: () => [],
        listInstructionContributions: () => [],
        findAgentTool: () => undefined,
        invokeAgentTool: async () => ({ success: false, contentItems: [] }),
        resolveMention: async () => ({ ok: false, error: "unused" }),
        resolveProviderEnvHealth: async () => null,
        resolveProviderEnv: async () => ({ entries: [] }),
      });
      const responder = registerHostRpcResponder(h, {
        hostId: host.id,
        sessionId: session.id,
        handle: async ({ command }): Promise<HostRpcHandlerResult> => {
          if (command.type === "provider.installation.status")
            return {
              ok: true,
              result: {
                executableName: "codex",
                executablePath: "/bin/codex",
                installed: true,
                installSource: "npmGlobal",
                currentVersion: "1.0.0",
                latestVersion: "1.0.0",
                minimumSupportedVersion: "1.0.0",
                npmPackageName: "codex",
                npmGlobalPackageVersion: null,
                installAction: null,
                needsUpdate: false,
                versionUnsupported: false,
              },
            };
          if (command.type === "provider.health") {
            healthCommand = command;
            return {
              ok: true,
              result: {
                supported: true,
                health: {
                  status:
                    scenario === "machine-auth" &&
                    !command.contributedEnv?.some(
                      (entry) =>
                        entry.name === "OPENAI_API_KEY" &&
                        entry.value === "SYNTHETIC_MACHINE_KEY",
                    )
                      ? "unauthenticated"
                      : "ready",
                  statusMessage: null,
                  accountEmail: null,
                  planLabel: null,
                  installedVersion: "1.0.0",
                  minimumSupportedVersion: "1.0.0",
                  canInstall: false,
                  canUpdate: false,
                  loginCommand: "login",
                },
              },
            };
          }
          if (command.type === "workspace.readiness.inspect") {
            try {
              return { ok: true, result: await inspectReadiness(command.path) };
            } catch {
              return {
                ok: false,
                errorCode: "not_git",
                errorMessage: "Not a git repository",
              };
            }
          }
          if (command.type === "environment.hook.run") {
            actualHookRuns++;
            await daemonHook(command, {
              ...createDaemonHarness().dispatchOptions({
                dataDir: h.deps.config.dataDir,
              }),
              runtimeManager,
            });
            return { ok: true, result: {} };
          }
          if (command.type === "environment.hook.cancel")
            return { ok: true, result: { status: "terminated" as const } };
          throw Error("Unexpected " + command.type);
        },
      });
      try {
        if (scenario.startsWith("legacy")) {
          h.db
            .insert(environmentHookOperations)
            .values({
              id: "old-create-hook",
              operationId: "old-operation",
              hostId: host.id,
              path,
              kind: "setup",
              startedAt: 1,
              finishedAt: 2,
              error: null,
            })
            .run();
          if (scenario === "legacy-completed") {
            await runEnvironmentHook(h.deps, {
              id: "old-create-hook",
              hostId: host.id,
              path,
              kind: "setup",
              resumeOnly: false,
              report: { step() {}, log() {} },
              signal: new AbortController().signal,
            });
            expect(
              h.db.select().from(environmentSetupOutcomes).get()?.state,
            ).toBe("passed");
          }
        }
        if (scenario === "personal") {
          await writeFile(join(path, ".bb-env-setup.sh"), "exit 0\n");
          await runEnvironmentHook(h.deps, {
            id: "personal-create",
            hostId: host.id,
            path,
            kind: "setup",
            resumeOnly: false,
            report: { step() {}, log() {} },
            signal: new AbortController().signal,
          });
          expect(actualHookRuns).toBe(1);
          expect(
            h.db.select().from(environmentSetupOutcomes).get()?.state,
          ).toBe("passed");
        }
        if (scenario === "machine-auth") {
          await updateMachineEnvironment(
            h.db,
            h.deps.config.dataDir,
            "OPENAI_API_KEY",
            {
              name: "OPENAI_API_KEY",
              value: "SYNTHETIC_MACHINE_KEY",
              secret: true,
              note: null,
            },
          );
        }
        const result = await ensureHostReady(h.deps, {
          hostId: host.id,
          projectId: project.id,
          providerId: "codex",
          threadId: null,
          path,
        });
        expect(result).toMatchObject({ status: "ready" });
        if (scenario === "personal") {
          await writeFile(join(path, ".bb-env-setup.sh"), "exit 1\n");
          expect(
            await ensureHostReady(h.deps, {
              hostId: host.id,
              projectId: project.id,
              providerId: "codex",
              threadId: null,
              path,
            }),
          ).toMatchObject({ status: "blocked", code: "setup_stale" });
          expect(actualHookRuns).toBe(1);
        }
        if (scenario.startsWith("legacy")) expect(actualHookRuns).toBe(0);
        if (scenario === "machine-auth") {
          expect(healthCommand).toHaveProperty("contributedEnv");
          expect(
            await resolveUserMachineEnvironment(h.db, h.deps.config.dataDir),
          ).toContainEqual(
            expect.objectContaining({
              name: "OPENAI_API_KEY",
              value: "SYNTHETIC_MACHINE_KEY",
            }),
          );
        }
        expect(h.db.$client.pragma("foreign_key_check")).toEqual([]);
      } finally {
        await runtimeManager.shutdownAll();
        responder.unregister();
        setPluginAgentContributions(undefined);
        vi.unstubAllEnvs();
      }
    });
  },
);
