import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  createFakePluginHost,
  makeThreadResponse,
} from "@bb/plugin-sdk/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPluginContext,
  type PluginContext,
} from "../../../../lib/context.js";
import { AssuranceStudioClient } from "../../../../lib/remote/assurance-studio/client.js";
import { PlatformClient } from "../../../../lib/remote/platform/client.js";
import type { AsEntity, RemoteServices } from "../../../../lib/remote/types.js";
import { createMockPlatformState } from "../../../../test/mock-remote/platform/state.js";
import { registerPlatformHandlers } from "../../../../test/mock-remote/platform/register.js";
import { registerMockPlatformFirmware } from "../../../../test/mock-remote/platform/firmware.js";
import { registerMockAssuranceStudio } from "../../../../test/mock-remote/assurance-studio/register.js";
import {
  createMockRemote,
  type MockRemoteHarness,
} from "../../../../test/mock-remote/server.js";
import { registerBench } from "../../../bench/register.js";
import { registerFirmware } from "../../../firmware/register.js";
import { registerSync } from "../../../sync/register.js";
import { registerProductSecurity } from "../../register.js";

const FIXTURE_ROOT = resolve(
  import.meta.dirname,
  "../../../../test/mock-remote/fixtures",
);
const WORKSPACE_PROJECT_ID = "workspace-fs201";
const THREAD_ID = "thread-fs201";
const ENVIRONMENT_ID = "environment-fs201";
const HOST_ID = "host-fs201";

let root: string;
let host: ReturnType<typeof createFakePluginHost>;
let ctx: PluginContext;
let mock: MockRemoteHarness;
let platform: PlatformClient;
let assuranceStudio: AssuranceStudioClient;
let platformProjectId: string;
let projectVersionId: string;
let acceptedRequirementGeneration: string;
const spawnedProjectIds: string[] = [];

function requiredId(
  row: Record<string, unknown> | undefined,
  label: string,
): string {
  const id = row?.["id"];
  if (typeof id !== "string" || id.length === 0)
    throw new Error(`${label} has no id`);
  return id;
}

function cliContext() {
  return { projectId: WORKSPACE_PROJECT_ID, threadId: THREAD_ID };
}

describe.sequential("registered requirement-to-bench journey", () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "fs201-requirement-bench-"));
    execFileSync("git", ["init", "--quiet", root]);
    await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
    host = createFakePluginHost({
      pluginId: "finite-state-fs201",
      sdk: {
        projects: {
          get: async ({ projectId }) => {
            if (projectId !== WORKSPACE_PROJECT_ID)
              throw new Error(`Project not found: ${projectId}`);
            return {
              id: projectId,
              kind: "standard" as const,
              name: "FS-201",
              gitRemoteUrl: null,
              createdAt: 1,
              updatedAt: 1,
              sources: [
                {
                  id: "source-fs201",
                  projectId,
                  type: "local_path" as const,
                  hostId: HOST_ID,
                  path: root,
                  isDefault: true,
                  createdAt: 1,
                  updatedAt: 1,
                },
              ],
            };
          },
        },
        threads: {
          get: async () =>
            makeThreadResponse({
              id: THREAD_ID,
              projectId: WORKSPACE_PROJECT_ID,
              environmentId: ENVIRONMENT_ID,
            }),
          spawn: async (input) => {
            spawnedProjectIds.push(input.projectId);
            return { id: "bench-thread-fs201" };
          },
        },
        environments: {
          get: async () => ({
            id: ENVIRONMENT_ID,
            projectId: WORKSPACE_PROJECT_ID,
            path: root,
            hostId: HOST_ID,
          }),
        },
        hosts: {
          list: async () => [
            {
              id: HOST_ID,
              name: "FS-201 bench host",
              type: "persistent" as const,
              status: "connected" as const,
              maxPermissionMode: "full" as const,
              lastSeenAt: 1,
              lastRejectedProtocolVersion: null,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
      },
    });
    const platformState = createMockPlatformState(FIXTURE_ROOT);
    platformProjectId = requiredId(
      [...platformState.projects.values()][0],
      "project fixture",
    );
    let firmwareFixtureVersionId: string | null = null;
    mock = createMockRemote({
      platformToken: "fs201-platform-token",
      assuranceStudioKey: "fs201-as-key",
      fixtureRoot: FIXTURE_ROOT,
      register(service, registry) {
        if (service === "platform") {
          registerPlatformHandlers(registry, platformState);
          firmwareFixtureVersionId = registerMockPlatformFirmware(
            registry,
            FIXTURE_ROOT,
          ).projectVersionId;
        } else {
          registerMockAssuranceStudio(registry, FIXTURE_ROOT);
        }
      },
    });
    platform = new PlatformClient({
      baseUrl: "http://platform.mock",
      token: "fs201-platform-token",
      fetch: mock.platform.fetch,
    });
    assuranceStudio = new AssuranceStudioClient({
      baseUrl: "http://assurance-studio.mock",
      apiKey: "fs201-as-key",
      fetch: mock.assuranceStudio.fetch,
    });
    ctx = createPluginContext(host.bb);
    const services: RemoteServices = {
      platform,
      assuranceStudio,
      forgeCompute: null,
    };
    ctx.service<RemoteServices>("remote-services", () => services);
    registerSync(host.bb, ctx);
    registerProductSecurity(host.bb, ctx);
    registerFirmware(host.bb, ctx);
    registerBench(host.bb, ctx);
    if (firmwareFixtureVersionId === null)
      throw new Error("firmware fixture has no project version");
    projectVersionId = firmwareFixtureVersionId;
  });

  afterAll(async () => {
    platform.close();
    assuranceStudio.close();
    await mock.close();
    await host.harness.lifecycle.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it("keeps requirements out of default Sync surfaces and exposes a clean pre-run Bench state", async () => {
    const candidates = await host.harness.behavior.runCli(
      ["finite-state", "as-projects", "--project", platformProjectId, "--json"],
      cliContext(),
    );
    expect(candidates).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(candidates.stdout)).toMatchObject({
      candidateState: "unambiguous",
      selectedAssuranceStudioProjectId: null,
      items: [
        expect.objectContaining({
          assuranceStudioProjectId: platformProjectId,
        }),
      ],
    });
    const selected = await host.harness.behavior.runCli(
      [
        "finite-state",
        "as-project-select",
        "--project",
        platformProjectId,
        "--as-project",
        platformProjectId,
        "--json",
      ],
      cliContext(),
    );
    expect(selected).toMatchObject({ exitCode: 0, stderr: "" });

    const defaultPull = await host.harness.behavior.runCli(
      [
        "finite-state",
        "pull",
        "--project",
        platformProjectId,
        "--version",
        projectVersionId,
        "--json",
      ],
      cliContext(),
    );
    expect(defaultPull).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(defaultPull.stdout).kinds).not.toHaveProperty(
      "requirement",
    );

    const defaultPlan = await host.harness.behavior.callRpc("syncPlan", {
      workspaceProjectId: WORKSPACE_PROJECT_ID,
      projectId: platformProjectId,
      projectVersionId,
      pageSize: 200,
      continuation: null,
    });
    expect(defaultPlan).toMatchObject({
      items: expect.not.arrayContaining([
        expect.objectContaining({ kind: "requirement" }),
      ]),
    });

    const pulled = await host.harness.behavior.runCli(
      [
        "finite-state",
        "pull",
        "requirement",
        "--project",
        platformProjectId,
        "--version",
        projectVersionId,
        "--json",
      ],
      cliContext(),
    );
    expect(pulled).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(pulled.stdout)).toMatchObject({
      kinds: { requirement: { fetched: 40, baseRows: 40, quarantined: 0 } },
    });
    acceptedRequirementGeneration = ctx
      .db()
      .prepare<[string, string], { accepted_generation_id: string }>(
        `SELECT accepted_generation_id FROM sync_state
          WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'requirement'`,
      )
      .get(platformProjectId, projectVersionId)!.accepted_generation_id;

    await expect(
      host.harness.behavior.callRpc("benchProjectVersions", {
        projectId: WORKSPACE_PROJECT_ID,
      }),
    ).resolves.toMatchObject({
      selectedPlatformProjectId: platformProjectId,
      selectedProjectVersionId: projectVersionId,
    });
    await expect(
      host.harness.behavior.callRpc("benchRunsList", {
        projectId: platformProjectId,
        projectVersionId,
        pageSize: 50,
        continuation: null,
      }),
    ).resolves.toMatchObject({
      items: [],
      total: 0,
      cache: {
        state: "empty",
        message:
          "No bench runs exist yet. Start the first run for this cached requirement version.",
      },
    });
  });

  it("materializes firmware through the registered CLI, succeeds the run, and renders the explicit verdict", async () => {
    const firmware = await host.harness.behavior.runCli(
      ["finite-state", "firmware", "pull", projectVersionId, "--source", "api"],
      cliContext(),
    );
    expect(firmware).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(firmware.stdout)).toMatchObject({ state: "COMPLETED" });
    await expect(
      host.harness.behavior.callRpc("firmwareMountsList", {
        projectId: WORKSPACE_PROJECT_ID,
        projectVersionId,
        pageSize: 10,
        continuation: null,
      }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          fields: expect.objectContaining({
            artifactHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        }),
      ],
    });

    const started = await host.harness.behavior.callRpc(
      "benchRunAttemptStart",
      {
        projectId: platformProjectId,
        projectVersionId,
        tier: "tier0",
        hostId: HOST_ID,
      },
    );
    expect(started).toMatchObject({
      success: true,
      run: { projectId: platformProjectId, projectVersionId },
    });
    expect(spawnedProjectIds).toEqual([WORKSPACE_PROJECT_ID]);
    expect(
      ctx
        .db()
        .prepare<[string, string], { requested_kinds_json: string }>(
          `SELECT requested_kinds_json FROM pull_generation
            WHERE project_id = ? AND project_version_id = ?
              AND requested_kinds_json LIKE '%local_bench_evidence%'`,
        )
        .get(platformProjectId, projectVersionId),
    ).toEqual({
      requested_kinds_json:
        '{"source":"local_bench_evidence","kinds":["verificationRun"]}',
    });

    await expect(
      host.harness.behavior.callRpc("benchOtaVerdictGet", {
        projectId: platformProjectId,
        pvId: projectVersionId,
      }),
    ).resolves.toMatchObject({
      verdict: "INCONCLUSIVE",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "MODEL_UNAVAILABLE" }),
      ]),
    });
  });

  it("preserves acceptance on an interrupted pull and handles an empty upstream", async () => {
    const originalListEntities =
      assuranceStudio.listEntities.bind(assuranceStudio);
    assuranceStudio.listEntities = (kind, input, callContext) => ({
      async *[Symbol.asyncIterator]() {
        for await (const page of originalListEntities(
          kind,
          input,
          callContext,
        )) {
          yield page;
          throw new Error("induced requirement page failure");
        }
      },
    });
    const failed = await host.harness.behavior.runCli(
      [
        "finite-state",
        "pull",
        "requirement",
        "--project",
        platformProjectId,
        "--version",
        projectVersionId,
      ],
      cliContext(),
    );
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toContain("induced requirement page failure");
    expect(
      ctx
        .db()
        .prepare<[string, string], { accepted_generation_id: string }>(
          `SELECT accepted_generation_id FROM sync_state
            WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'requirement'`,
        )
        .get(platformProjectId, projectVersionId)!.accepted_generation_id,
    ).toBe(acceptedRequirementGeneration);

    assuranceStudio.listEntities = () => ({
      async *[Symbol.asyncIterator]() {
        yield { items: [] as AsEntity[], total: 0, next: null };
      },
    });
    const emptyVersion = "empty-requirements-version";
    const empty = await host.harness.behavior.runCli(
      [
        "finite-state",
        "pull",
        "requirement",
        "--project",
        platformProjectId,
        "--version",
        emptyVersion,
        "--json",
      ],
      cliContext(),
    );
    expect(JSON.parse(empty.stdout)).toMatchObject({
      kinds: { requirement: { fetched: 0, baseRows: 0, quarantined: 0 } },
    });
    await expect(
      host.harness.behavior.callRpc("benchProjectVersions", {
        projectId: WORKSPACE_PROJECT_ID,
      }),
    ).resolves.toMatchObject({
      versions: expect.arrayContaining([
        expect.objectContaining({ projectVersionId: emptyVersion }),
      ]),
    });
  });
});
