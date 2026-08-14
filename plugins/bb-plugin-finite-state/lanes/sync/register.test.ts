import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  createFakePluginHost,
  makeThreadResponse,
} from "@bb/plugin-sdk/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPluginContext } from "../../lib/context.js";
import type { PluginContext } from "../../lib/context.js";
import { AssuranceStudioClient } from "../../lib/remote/assurance-studio/client.js";
import { PlatformClient } from "../../lib/remote/platform/client.js";
import { RemoteError } from "../../lib/remote/types.js";
import type {
  Json,
  RemotePage,
  RemoteServices,
} from "../../lib/remote/types.js";
import {
  bindWorkspacePlatformProject,
  selectAssuranceStudioProjectBinding,
} from "../../lib/store/project-scope.js";
import { ENTITIES, parseFindingStableKey } from "../../lib/sync/registry.js";
import { rpcContract } from "../../shared/contract.js";
import { registerFindings } from "../findings/register.js";
import {
  createMockRemote,
  type MockRemoteHarness,
} from "../../test/mock-remote/server.js";
import { registerPlatformHandlers } from "../../test/mock-remote/platform/register.js";
import { registerMockAssuranceStudio } from "../../test/mock-remote/assurance-studio/register.js";
import {
  createMockPlatformState,
  type MockPlatformState,
} from "../../test/mock-remote/platform/state.js";
import { createSerializer } from "./serialize/serializer.js";
import type { IsolatedPullReport } from "./pull-outcome.js";
import {
  DuplicateAdapterError,
  registerAdapter,
  type EntityAdapter,
  type ServerEntity,
  type WorkingEntity,
} from "./engine/adapter.js";
import { pull } from "./engine/pull.js";
import { status } from "./engine/status.js";
import { registerSync } from "./register.js";

const FIXTURE_ROOT = resolve(
  import.meta.dirname,
  "../../test/mock-remote/fixtures",
);
const TOKEN = "wp17-register-token";
const host = createFakePluginHost({ pluginId: "finite-state-wp17-register" });
let mock: MockRemoteHarness;
let state: MockPlatformState;
let platform: PlatformClient;
let root: string;
let context: PluginContext;

const requirementKey = ENTITIES.requirement.key({ reqId: "REQ-SEAM" });
let remoteRequirements: ServerEntity[] = [
  {
    key: requirementKey,
    remoteId: "as-requirement-seam",
    payload: {
      id: "as-requirement-seam",
      projectId: "project-seam",
      kind: "requirement",
      fields: { reqId: "REQ-SEAM", title: "base" },
      humanEdited: null,
      reviewStatus: null,
      reviewVersion: null,
    },
  },
];
let workingRequirements: WorkingEntity[] = [
  {
    key: requirementKey,
    payload: { reqId: "REQ-SEAM", title: "base" },
    file: "product-security/requirements/REQ-SEAM.yaml",
  },
];
let remoteRequirementError: Error | null = null;
let remoteRequirementScopes: string[] = [];

const foreignAdapter: EntityAdapter = {
  kind: "requirement",
  klass: "VERSIONED",
  serializer: createSerializer("requirement"),
  async *fetchRemote(scope, progress) {
    remoteRequirementScopes.push(scope.projectId);
    if (remoteRequirementError) throw remoteRequirementError;
    progress({ page: 1, of: 1 });
    yield remoteRequirements;
  },
  async readWorking() {
    return workingRequirements;
  },
};

beforeAll(async () => {
  state = createMockPlatformState(FIXTURE_ROOT);
  mock = createMockRemote({
    platformToken: TOKEN,
    assuranceStudioKey: "unused",
    fixtureRoot: FIXTURE_ROOT,
    register(service, registry) {
      if (service === "platform") registerPlatformHandlers(registry, state);
      else registerMockAssuranceStudio(registry, FIXTURE_ROOT);
    },
  });
  platform = new PlatformClient({
    baseUrl: "http://platform.mock",
    token: TOKEN,
    fetch: mock.platform.fetch,
  });
  const services: RemoteServices = {
    platform,
    assuranceStudio: new AssuranceStudioClient({
      baseUrl: "http://assurance-studio.mock",
      apiKey: "unused",
      fetch: mock.assuranceStudio.fetch,
    }),
    forgeCompute: null,
  };
  context = createPluginContext(host.bb);
  context.service<RemoteServices>("remote-services", () => services);
  context.service("firmware.cli", () => ({
    run: async (argv: string[]) => ({
      exitCode: 0,
      stdout: `${JSON.stringify({ namespace: "firmware", argv })}\n`,
      stderr: "",
    }),
  }));
  context.service("bench.cli", () => ({
    run: async (argv: string[]) => ({
      exitCode: 0,
      stdout: `${JSON.stringify({ namespace: "bench", argv })}\n`,
      stderr: "",
    }),
  }));
  registerSync(host.bb, context);
  registerAdapter(foreignAdapter);
  root = await mkdtemp(join(tmpdir(), "fs-wp17-register-"));
  host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({
      id: "thread-sync-cli",
      projectId: "bb-project-sync",
      environmentId: "environment-sync-cli",
    }),
  );
  host.harness.sdk.stub("environments.get", async () => ({
    id: "environment-sync-cli",
    projectId: "bb-project-sync",
    hostId: "host-sync",
    path: root,
  }));
  host.harness.sdk.stub("projects.get", async ({ projectId }) => {
    if (projectId === "junk-workspace-project") {
      throw new Error("Workspace project not found");
    }
    return {
      id: projectId,
      sources: [{ hostId: "host-sync", path: root, isDefault: true }],
    };
  });
});

afterAll(async () => {
  platform.close();
  await mock.close();
  await host.harness.lifecycle.dispose();
  await rm(root, { recursive: true, force: true });
});

function platformScope() {
  const project = [...state.projects.values()][0];
  const finding = [...state.findings.values()].find(
    (row) => row["vexStatus"] !== null,
  );
  if (
    typeof project?.["id"] !== "string" ||
    typeof finding?.["projectVersionId"] !== "string"
  ) {
    throw new Error("fixture has no platform scope");
  }
  return {
    projectId: project["id"],
    projectVersionId: finding["projectVersionId"],
  };
}

function findingComponentIdentity(finding: Record<string, unknown>): {
  purl: string | null;
  name: string;
  group: string | null;
  version: string;
} | null {
  const component = finding["component"];
  if (
    component === null ||
    Array.isArray(component) ||
    typeof component !== "object" ||
    !("name" in component) ||
    typeof component.name !== "string" ||
    !("version" in component) ||
    typeof component.version !== "string"
  )
    return null;
  return {
    purl:
      typeof finding["componentPurl"] === "string"
        ? finding["componentPurl"]
        : null,
    name:
      typeof finding["componentName"] === "string"
        ? finding["componentName"]
        : component.name,
    group:
      typeof finding["componentGroup"] === "string"
        ? finding["componentGroup"]
        : null,
    version:
      typeof finding["componentVersion"] === "string"
        ? finding["componentVersion"]
        : component.version,
  };
}

describe("sync registration", () => {
  it("round-trips a foreign registry adapter registered entirely from test code", async () => {
    const deps = {
      db: context.db(),
      worktreeRoot: root,
      isFileClean: async () => true,
      createGenerationId: () => "generation-seam-proof",
      now: () => new Date("2026-08-12T20:00:00.000Z"),
    };
    await expect(
      pull(
        deps,
        { projectId: "project-seam", projectVersionId: "version-seam" },
        ["requirement"],
        { assuranceStudioProjectId: "as-project-seam" },
      ),
    ).resolves.toMatchObject({
      kinds: { requirement: { fetched: 1, baseRows: 1, quarantined: 0 } },
    });
    workingRequirements = [
      {
        ...workingRequirements[0]!,
        payload: { reqId: "REQ-SEAM", title: "local edit" },
      },
    ];
    await expect(
      status(
        deps,
        { projectId: "project-seam", projectVersionId: "version-seam" },
        ["requirement"],
        { assuranceStudioProjectId: "as-project-seam" },
      ),
    ).resolves.toMatchObject({
      local: [{ kind: "requirement", key: requirementKey, fields: ["title"] }],
      upstream: [],
      conflicts: [],
    });
  });

  it("throws on duplicate kind registration", () => {
    expect(() => registerAdapter(foreignAdapter)).toThrow(
      DuplicateAdapterError,
    );
  });

  it("serves frozen sync RPCs and fails push closed when human authorization is unavailable", async () => {
    remoteRequirementScopes = [];
    const scope = platformScope();
    await expect(
      host.harness.behavior.callRpc("syncPull", {
        ...scope,
        workspaceProjectId: "junk-workspace-project",
        kinds: ["requirement"],
      }),
    ).rejects.toThrow("Workspace project not found");
    expect(
      context
        .db()
        .prepare(
          `SELECT COUNT(*)
             FROM workspace_platform_project_binding
            WHERE workspace_project_id = ?`,
        )
        .pluck()
        .get("junk-workspace-project"),
    ).toBe(0);

    await expect(
      host.harness.behavior.callRpc("syncPull", {
        ...scope,
        workspaceProjectId: "bb-project-sync",
        kinds: ["requirement"],
      }),
    ).resolves.toMatchObject({
      kinds: {
        requirement: {
          status: "failed",
          generationId: null,
          acceptedAt: null,
          fetched: 0,
          baseRows: 0,
          quarantined: 0,
          reasons: [{ code: "AS_PROJECT_SELECTION_REQUIRED", count: 1 }],
        },
      },
    });
    bindWorkspacePlatformProject(
      context.db(),
      "bb-project-sync",
      scope.projectId,
    );
    selectAssuranceStudioProjectBinding(
      context.db(),
      "bb-project-sync",
      scope.projectId,
      "as-project-explicit",
    );

    const pulled = rpcContract.syncPull.output.parse(
      await host.harness.behavior.callRpc("syncPull", {
        ...scope,
        workspaceProjectId: "bb-project-sync",
        kinds: ["requirement", "vexDecision"],
      }),
    );
    expect(pulled).toMatchObject({
      ...scope,
      baseStateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      kinds: {
        requirement: {
          status: "published",
          generationId: expect.any(String),
          fetched: 1,
          baseRows: 1,
          quarantined: 0,
        },
        vexDecision: {
          status: "published",
          generationId: expect.any(String),
          fetched: expect.any(Number),
          baseRows: expect.any(Number),
          quarantined: expect.any(Number),
        },
      },
    });
    const requirementOutcome = pulled.kinds.requirement;
    const vexDecisionOutcome = pulled.kinds.vexDecision;
    if (
      requirementOutcome?.status !== "published" ||
      vexDecisionOutcome?.status !== "published"
    ) {
      throw new Error("syncPull did not publish both requested kinds");
    }
    const requirementGenerationId = requirementOutcome.generationId;
    const vexDecisionGenerationId = vexDecisionOutcome.generationId;
    expect(
      context
        .db()
        .prepare(
          `SELECT platform_project_id
             FROM workspace_platform_project_binding
            WHERE workspace_project_id = ?`,
        )
        .pluck()
        .all("bb-project-sync"),
    ).toEqual([scope.projectId]);

    bindWorkspacePlatformProject(
      context.db(),
      "bb-project-failed-sync",
      scope.projectId,
    );
    selectAssuranceStudioProjectBinding(
      context.db(),
      "bb-project-failed-sync",
      scope.projectId,
      "as-project-explicit",
    );
    remoteRequirementError = new Error("registered RPC pull failed");
    try {
      await expect(
        host.harness.behavior.callRpc("syncPull", {
          ...scope,
          workspaceProjectId: "bb-project-failed-sync",
          kinds: ["requirement"],
        }),
      ).resolves.toMatchObject({
        kinds: {
          requirement: {
            status: "failed",
            reasons: [{ code: "PULL_KIND_FAILED", count: 1 }],
          },
        },
      });
    } finally {
      remoteRequirementError = null;
    }
    expect(
      context
        .db()
        .prepare(
          `SELECT platform_project_id, assurance_studio_project_id
             FROM workspace_platform_project_binding
            WHERE workspace_project_id = ?`,
        )
        .all("bb-project-failed-sync"),
    ).toEqual([
      {
        platform_project_id: scope.projectId,
        assurance_studio_project_id: "as-project-explicit",
      },
    ]);
    const statusReport = await host.harness.behavior.callRpc("syncStatus", {
      ...scope,
      workspaceProjectId: "bb-project-sync",
    });
    // Frozen RPC inputs carry no thread or worktree capability, so working
    // local/orphan state is intentionally unavailable on this surface.
    expect(statusReport).toMatchObject({
      ...scope,
      local: [],
      upstream: [],
      conflicts: [],
      orphans: [],
      acceptedGenerationIds: {
        requirement: requirementGenerationId,
        vexDecision: vexDecisionGenerationId,
      },
      cache: { acceptedGenerationId: null },
    });
    await expect(
      host.harness.behavior.callRpc("syncPlan", {
        ...scope,
        workspaceProjectId: "bb-project-sync",
      }),
    ).resolves.toMatchObject({
      ...scope,
      planId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/u),
      planSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      baseGenerationIds: {
        requirement: requirementGenerationId,
        vexDecision: vexDecisionGenerationId,
      },
      items: expect.any(Array),
      total: expect.any(Number),
      staleness: { degraded: true },
      cache: {
        state: "stale",
        message:
          "Working tree unavailable; plan includes upstream changes only",
        acceptedGenerationId: null,
      },
    });
    const firstFilteredPage = await host.harness.behavior.callRpc("syncPlan", {
      ...scope,
      workspaceProjectId: "bb-project-sync",
      kinds: ["vexDecision"],
      pageSize: 1,
      continuation: null,
    });
    if (
      typeof firstFilteredPage !== "object" ||
      firstFilteredPage === null ||
      !("next" in firstFilteredPage) ||
      typeof firstFilteredPage.next !== "string" ||
      !("planId" in firstFilteredPage) ||
      typeof firstFilteredPage.planId !== "string"
    ) {
      throw new Error(
        "registered filtered syncPlan fixture did not produce a continuation",
      );
    }
    const continuedFilteredPage = await host.harness.behavior.callRpc(
      "syncPlan",
      {
        ...scope,
        workspaceProjectId: "bb-project-sync",
        pageSize: 1,
        continuation: firstFilteredPage.next,
      },
    );
    expect(continuedFilteredPage).toMatchObject({
      ...scope,
      planId: firstFilteredPage.planId,
      items: [expect.objectContaining({ kind: "vexDecision" })],
    });
    await expect(
      host.harness.behavior.callRpc("syncPlan", {
        ...scope,
        workspaceProjectId: "bb-project-sync",
        kinds: ["vexDecision"],
        pageSize: 1,
        continuation: firstFilteredPage.next,
      }),
    ).rejects.toMatchObject({
      code: "handler_error",
      message: expect.stringContaining(
        "PLAN_CONTINUATION_INVALID: kinds are bound by the persisted plan token",
      ),
    });
    expect(remoteRequirementScopes.length).toBeGreaterThanOrEqual(3);
    expect(new Set(remoteRequirementScopes)).toEqual(
      new Set(["as-project-explicit"]),
    );
    const pushInput = {
      ...scope,
      planId: "plan-wp17",
      expectedPlanSha256: "a".repeat(64),
      expectedBaseStateSha256: "b".repeat(64),
      humanApprovalCapability: "approval-capability-wp17-00000000",
    };
    await expect(
      host.harness.behavior.callRpc("syncPush", pushInput),
    ).rejects.toMatchObject({
      code: "handler_error",
      message: expect.stringContaining("authorization-unavailable"),
    });
    await expect(
      host.harness.behavior.callRpc("syncPushRetry", {
        ...pushInput,
        runId: "push-run-wp19",
      }),
    ).rejects.toMatchObject({
      code: "handler_error",
      message: expect.stringContaining("authorization-unavailable"),
    });
    expect(host.harness.registrations.rpcMethods).toEqual(
      expect.arrayContaining([
        "syncPull",
        "syncStatus",
        "syncPlan",
        "syncConflictResolve",
        "syncPush",
        "syncPushRetry",
      ]),
    );
  });

  it("enumerates every ambiguous AS link and persists only the explicit RPC selection", async () => {
    const listed = rpcContract.syncAsProjectCandidates.output.parse(
      await host.harness.behavior.callRpc("syncAsProjectCandidates", {
        workspaceProjectId: "bb-project-sync",
        projectId: "platform-project-a",
        projectVersionId: null,
      }),
    );
    expect(listed).toMatchObject({
      platformProjectId: "platform-project-a",
      candidateState: "ambiguous",
      selectedAssuranceStudioProjectId: null,
    });
    expect(listed.items).toHaveLength(4);

    await expect(
      host.harness.behavior.callRpc("syncAsProjectCandidates", {
        workspaceProjectId: "bb-project-sync",
        projectId: "platform-project-c",
        projectVersionId: null,
      }),
    ).resolves.toMatchObject({
      platformProjectId: "platform-project-c",
      candidateState: "unambiguous",
      selectedAssuranceStudioProjectId: null,
      items: [
        expect.objectContaining({
          assuranceStudioProjectId: "as-project-c1",
        }),
      ],
    });
    await expect(
      host.harness.behavior.callRpc("syncAsProjectCandidates", {
        workspaceProjectId: "bb-project-sync",
        projectId: "platform-project-unlinked",
        projectVersionId: null,
      }),
    ).resolves.toMatchObject({
      platformProjectId: "platform-project-unlinked",
      candidateState: "none",
      selectedAssuranceStudioProjectId: null,
      items: [],
    });

    await host.harness.behavior.callRpc("syncAsProjectSelect", {
      workspaceProjectId: "bb-project-sync",
      projectId: "platform-project-a",
      projectVersionId: null,
      assuranceStudioProjectId: "as-project-a3",
    });
    expect(
      context
        .db()
        .prepare(
          `SELECT assurance_studio_project_id
             FROM workspace_platform_project_binding
            WHERE workspace_project_id = ? AND platform_project_id = ?`,
        )
        .pluck()
        .get("bb-project-sync", "platform-project-a"),
    ).toBe("as-project-a3");
    await expect(
      host.harness.behavior.callRpc("syncAsProjectSelect", {
        workspaceProjectId: "bb-project-sync",
        projectId: "platform-project-a",
        projectVersionId: null,
        assuranceStudioProjectId: "as-project-b1",
      }),
    ).rejects.toThrow("AS_PROJECT_SELECTION_NOT_LINKED");
  });

  it("exposes explicit AS project enumeration and selection through the registered CLI", async () => {
    const contextInput = {
      cwd: "/untrusted-cwd",
      threadId: "thread-sync-cli",
      projectId: "bb-project-sync",
    };
    const listed = await host.harness.behavior.runCli(
      [
        "finite-state",
        "as-projects",
        "--project",
        "platform-project-b",
        "--json",
      ],
      contextInput,
    );
    expect(listed).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(listed.stdout)).toMatchObject({
      platformProjectId: "platform-project-b",
      candidateState: "ambiguous",
      selectedAssuranceStudioProjectId: null,
      items: expect.arrayContaining([
        expect.objectContaining({
          assuranceStudioProjectId: "as-project-b2",
        }),
      ]),
    });

    const selected = await host.harness.behavior.runCli(
      [
        "finite-state",
        "as-project-select",
        "--project",
        "platform-project-b",
        "--as-project",
        "as-project-b2",
        "--json",
      ],
      contextInput,
    );
    expect(selected).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(selected.stdout)).toMatchObject({
      platformProjectId: "platform-project-b",
      selected: { assuranceStudioProjectId: "as-project-b2" },
    });
  });

  it("partitions direct-Platform local, upstream, and both-side VEX edits exactly", async () => {
    const scope = platformScope();
    const deps = {
      db: context.db(),
      worktreeRoot: root,
      isFileClean: async () => false,
    };
    await pull(deps, scope, ["vexDecision"]);
    const findings = [...state.findings.values()]
      .flatMap((row) => {
        const component = findingComponentIdentity(row);
        return row["projectVersionId"] === scope.projectVersionId &&
          typeof row["vexStatus"] === "string" &&
          component !== null
          ? [{ row, component }]
          : [];
      })
      .slice(0, 3);
    if (findings.length !== 3)
      throw new Error("fixture has fewer than three VEX findings");
    const directory = join(root, ".fs", "triage", scope.projectId);
    await mkdir(directory, { recursive: true });
    for (const [index, finding] of findings.entries()) {
      const { row, component } = finding;
      const localStatus =
        index === 0
          ? "NOT_AFFECTED"
          : index === 2
            ? "FALSE_POSITIVE"
            : row["vexStatus"];
      const localReason =
        index === 0 || index === 2 ? `local edit ${index}` : null;
      await writeFile(
        join(directory, `${index}.yaml`),
        `schema: fs-triage/v1
project: ${JSON.stringify(scope.projectId)}
component:
  purl: ${JSON.stringify(component.purl)}
  name: ${JSON.stringify(component.name)}
  group: ${JSON.stringify(component.group)}
  version: ${JSON.stringify(component.version)}
decisions:
  ${String(row["cve"])}:
    status: ${JSON.stringify(localStatus)}
    justification: null
    response: null
    reason: ${JSON.stringify(localReason)}
`,
        "utf8",
      );
    }
    findings[1]!.row["vexStatus"] = "RESOLVED";
    findings[1]!.row["vexReason"] = "upstream edit";
    findings[2]!.row["vexStatus"] = "EXPLOITABLE";
    findings[2]!.row["vexReason"] = "upstream conflict";

    const report = await status(deps, scope, ["vexDecision"]);
    expect(report.local).toHaveLength(1);
    expect(report.upstream).toHaveLength(1);
    expect(report.conflicts).toHaveLength(1);
    expect(report.orphans).toEqual([]);
    expect(Object.keys(report)).toEqual([
      "local",
      "upstream",
      "conflicts",
      "orphans",
    ]);
  });

  it("runs the verb-first triage CLI with the documented leading command tolerance", async () => {
    const priorThreadCalls = host.harness.sdk.callsTo("threads.get").length;
    const priorEnvironmentCalls =
      host.harness.sdk.callsTo("environments.get").length;
    await rm(join(root, ".fs"), { recursive: true, force: true });
    const result = await host.harness.behavior.runCli(
      ["finite-state", "pull", "triage"],
      {
        cwd: "/untrusted-cwd-must-not-be-used",
        threadId: "thread-sync-cli",
        projectId: "bb-project-sync",
      },
    );
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toMatch(
      /^Pull complete: 1 published, 0 failed\nvexDecision: published · \d+ fetched, \d+ base rows, 0 quarantined\n$/u,
    );
    const machine = await host.harness.behavior.runCli(
      ["status", "triage", "--json"],
      {
        cwd: "/untrusted-cwd-must-not-be-used",
        threadId: "thread-sync-cli",
        projectId: "bb-project-sync",
      },
    );
    expect(machine).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(machine.stdout)).toMatchObject({
      local: [],
      conflicts: [],
      orphans: [],
    });
    expect(
      host.harness.realtimeSignals.some(
        (signal) => signal.channel === "fs-sync-pull",
      ),
    ).toBe(true);
    expect(host.harness.sdk.callsTo("threads.get")).toHaveLength(
      priorThreadCalls + 2,
    );
    expect(host.harness.sdk.callsTo("environments.get")).toHaveLength(
      priorEnvironmentCalls + 2,
    );
  });

  it("logs isolated VEX rows and reports their lane advisory count through the registered CLI", async () => {
    const scope = platformScope();
    const findingId = "synthetic-register-advisory";
    state.findings.set(findingId, {
      id: findingId,
      projectVersionId: scope.projectVersionId,
      findingId: "CVE-2026-18000",
      component: { id: "opaque-only", version: "1.0" },
      vexStatus: "NOT_AFFECTED",
    });
    try {
      const result = await host.harness.behavior.runCli(
        [
          "pull",
          "triage",
          "--project",
          scope.projectId,
          "--version",
          scope.projectVersionId,
          "--json",
        ],
        {
          cwd: "/untrusted-cwd-must-not-be-used",
          threadId: "thread-sync-cli",
          projectId: "bb-project-sync",
        },
      );
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toMatchObject({
        kinds: {
          vexDecision: {
            status: "published",
            reasons: [{ code: "VEX_REMOTE_IDENTITY_MISSING", count: 1 }],
          },
        },
      });
      expect(host.harness.inspection.logEntries).toContainEqual({
        level: "warn",
        message:
          "VEX remote row isolated: VEX_REMOTE_IDENTITY_MISSING; finding=synthetic-register-advisory",
      });
    } finally {
      state.findings.delete(findingId);
    }
  });

  it("reports truthful counts and persists captured real findings through the registered CLI", async () => {
    registerFindings(host.bb, context);
    const scope = platformScope();
    const argv = [
      "pull",
      "finding",
      "--project",
      scope.projectId,
      "--version",
      scope.projectVersionId,
      "--json",
    ];
    const first = await host.harness.behavior.runCli(argv, {
      cwd: root,
      threadId: "thread-sync-cli",
      projectId: "bb-project-sync",
    });
    expect(first.exitCode).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      kinds: {
        finding: {
          status: "published",
          fetched: 4_001,
          baseRows: 4_000,
          quarantined: 0,
        },
      },
    });
    const repeated = await host.harness.behavior.runCli(argv, {
      cwd: root,
      threadId: "thread-sync-cli",
      projectId: "bb-project-sync",
    });
    expect(repeated.exitCode).toBe(0);
    expect(JSON.parse(repeated.stdout)).toMatchObject({
      kinds: {
        finding: {
          status: "published",
          fetched: 4_001,
          baseRows: 4_000,
          quarantined: 0,
        },
      },
    });

    for (const captured of [
      {
        projectId: "cfe6fb97-ed49-5ace-b0fe-8121dba2c793",
        projectVersionId: "b3df3633-ebd7-560e-a3b7-77953521b4e3",
        findingId: "0b529d2b-9da8-556e-81e4-f0f57a59956a",
        cve: "CVE-2016-4658",
        componentGroup: "debian",
        componentName: "libxml2",
        componentVersion: "2.9.4+dfsg1-2.2+deb9u2",
        expectedRows: 2,
      },
      {
        projectId: "5d78bed3-fa8e-59cf-b8a1-6046853ba785",
        projectVersionId: "89ad8a41-2185-5df0-968b-c250312c908b",
        findingId: "85c04807-db47-4853-b659-ece4214ef395",
        cve: "CVE-2026-34877",
        componentGroup: null,
        componentName: "Mbed TLS",
        componentVersion: "3.0.0",
        expectedRows: 1,
      },
    ]) {
      const result = await host.harness.behavior.runCli(
        [
          "pull",
          "finding",
          "--project",
          captured.projectId,
          "--version",
          captured.projectVersionId,
          "--json",
        ],
        {
          cwd: root,
          threadId: "thread-sync-cli",
          projectId: "bb-project-sync",
        },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        kinds: {
          finding: {
            status: "published",
            fetched: captured.expectedRows,
            baseRows: captured.expectedRows,
            quarantined: 0,
          },
        },
      });
      const persisted = context
        .db()
        .prepare(
          `SELECT cve, stable_key AS stableKey,
                  component_group AS componentGroup,
                  component_name AS componentName,
                  component_version AS componentVersion
           FROM findings
          WHERE project_id = ? AND project_version_id = ? AND finding_id = ?`,
        )
        .get(
          captured.projectId,
          captured.projectVersionId,
          captured.findingId,
        ) as
        | {
            cve: string;
            stableKey: string;
            componentGroup: string | null;
            componentName: string;
            componentVersion: string | null;
          }
        | undefined;
      expect(persisted).toMatchObject({
        cve: captured.cve,
        componentGroup: captured.componentGroup,
        componentName: captured.componentName,
        componentVersion: captured.componentVersion,
      });
      expect(parseFindingStableKey(persisted?.stableKey ?? "").cve).toBe(
        captured.cve,
      );
    }

    const originalFindings = [...state.findings.entries()];
    state.findings.clear();
    const mixedVersion = "fs193-mixed-version";
    const templateVersion = state.versions.get(scope.projectVersionId);
    if (templateVersion === undefined)
      throw new Error("fixture has no template Platform version");
    state.versions.set(mixedVersion, {
      ...templateVersion,
      id: mixedVersion,
    });
    const realShape = JSON.parse(
      readFileSync(
        resolve(FIXTURE_ROOT, "platform/fs193-binary-sast-specimen.json"),
        "utf8",
      ),
    ) as Record<string, Json>;
    const realShapeProjectVersion = realShape["projectVersion"];
    if (
      realShapeProjectVersion === null ||
      Array.isArray(realShapeProjectVersion) ||
      typeof realShapeProjectVersion !== "object"
    ) {
      throw new Error("real-shape specimen has no projectVersion object");
    }
    const mixedRows = [
      {
        ...realShape,
        projectVersion: {
          ...realShapeProjectVersion,
          id: mixedVersion,
        },
      },
      {
        id: "fs193-exact",
        projectVersionId: mixedVersion,
        findingId: "CVE-2026-19300",
        component: {
          id: "fs193-exact-component",
          name: "library",
          version: "1",
        },
      },
      {
        id: "fs199-advisory",
        projectVersionId: mixedVersion,
        findingId: "CVE-2026-19301",
        title: "https://remote.invalid/?api_key=must-not-reach-diagnostics",
        component: {
          id: "fs193-invalid-component",
          name: "hostile-library",
          version: "1.0.0",
        },
        epssScore: "authorization must-not-reach-diagnostics",
        warningCount: null,
        violations: "credential=must-not-reach-diagnostics",
      },
      {
        id: "fs193-quarantined",
        projectVersionId: mixedVersion,
        findingId: "CVE-2026-19302",
        component: { id: "fs193-invalid-component", version: "1.0.0" },
      },
    ];
    for (const row of mixedRows) {
      const rowId = row["id"];
      if (typeof rowId !== "string")
        throw new Error("mixed finding row has no string id");
      state.findings.set(rowId, row);
    }
    try {
      const mixed = rpcContract.syncPull.output.parse(
        await host.harness.behavior.callRpc("syncPull", {
          workspaceProjectId: "bb-project-sync",
          projectId: scope.projectId,
          projectVersionId: mixedVersion,
          kinds: ["finding"],
        }),
      );
      expect(mixed).toMatchObject({
        kinds: {
          finding: {
            status: "published",
            fetched: 4,
            baseRows: 3,
            quarantined: 1,
          },
        },
      });
      const mixedFinding = mixed.kinds.finding;
      if (mixedFinding?.status !== "published") {
        throw new Error("syncPull returned no mixed-corpus generation id");
      }
      const mixedGenerationId = mixedFinding.generationId;
      const persisted = context
        .db()
        .prepare(
          `SELECT finding_id AS findingId, stable_key AS stableKey,
                  epss_score AS epssScore, warning_count AS warningCount,
                  violation_count AS violationCount
             FROM findings
            WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
            ORDER BY finding_id`,
        )
        .all(scope.projectId, mixedVersion, mixedGenerationId) as Array<{
        findingId: string;
        stableKey: string;
        epssScore: number | null;
        warningCount: number;
        violationCount: number;
      }>;
      expect(persisted.map((row) => row.findingId)).toEqual([
        "00000000-0000-5000-8000-000000000193",
        "fs193-exact",
        "fs199-advisory",
      ]);
      expect(persisted[0]).toMatchObject({
        epssScore: 0.00426,
        warningCount: 2,
        violationCount: 1,
      });
      expect(parseFindingStableKey(persisted[0]?.stableKey ?? "").tier).toBe(
        "name-group-any-version",
      );
      expect(persisted[2]).toMatchObject({
        epssScore: null,
        warningCount: 0,
        violationCount: 0,
      });
      const registeredList = await host.harness.behavior.callRpc(
        "findingsUiList",
        {
          projectId: scope.projectId,
          projectVersionId: mixedVersion,
          pageSize: 100,
          continuation: null,
          filters: {},
        },
      );
      expect(registeredList).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            key: "00000000-0000-5000-8000-000000000193",
            fields: expect.objectContaining({
              epssScore: 0.00426,
              warningCount: 2,
              violationCount: 1,
            }),
          }),
          expect.objectContaining({
            key: "fs199-advisory",
            fields: expect.objectContaining({
              epssScore: null,
              warningCount: null,
              violationCount: null,
            }),
          }),
        ]),
      });
      const diagnostics = await host.harness.behavior.callRpc(
        "findingsPullAdvisories",
        {
          projectId: scope.projectId,
          projectVersionId: mixedVersion,
          generationId: mixedGenerationId,
        },
      );
      expect(diagnostics).toEqual({
        generationId: mixedGenerationId,
        advisories: [
          { code: "FINDING_COMPONENT_IDENTITY_MISSING", count: 1 },
          { code: "FINDING_EPSS_SCORE_INVALID", count: 1 },
          { code: "FINDING_VIOLATION_COUNT_INVALID", count: 1 },
          { code: "FINDING_WARNING_COUNT_INVALID", count: 1 },
        ],
      });
      const registeredDetail = await host.harness.behavior.callRpc(
        "findingDetailGet",
        {
          projectId: scope.projectId,
          projectVersionId: mixedVersion,
          stableKey: persisted[0]?.stableKey ?? "",
        },
      );
      expect(registeredDetail).toMatchObject({
        state: "resolved",
        rows: [
          expect.objectContaining({
            fields: expect.objectContaining({
              epssScore: 0.00426,
              warningCount: 2,
              violationCount: 1,
            }),
          }),
        ],
      });
      expect(host.harness.inspection.logEntries).toContainEqual({
        level: "warn",
        message:
          "Quarantined Platform finding rows with invalid identity: 1; reasons [FINDING_COMPONENT_IDENTITY_MISSING=1]",
      });
      expect(JSON.stringify(host.harness.inspection.logEntries)).not.toContain(
        "must-not-reach-diagnostics",
      );

      const mixedCli = await host.harness.behavior.runCli(
        [
          "pull",
          "finding",
          "--project",
          scope.projectId,
          "--version",
          mixedVersion,
          "--json",
        ],
        {
          cwd: root,
          threadId: "thread-sync-cli",
          projectId: "bb-project-sync",
        },
      );
      expect(mixedCli).toMatchObject({ exitCode: 0, stderr: "" });
      const mixedCliReport = JSON.parse(mixedCli.stdout) as IsolatedPullReport;
      expect(mixedCliReport).toMatchObject({
        kinds: {
          finding: {
            status: "published",
            fetched: 4,
            baseRows: 3,
            quarantined: 1,
            reasons: [
              { code: "FINDING_COMPONENT_IDENTITY_MISSING", count: 1 },
              { code: "FINDING_EPSS_SCORE_INVALID", count: 1 },
              { code: "FINDING_VIOLATION_COUNT_INVALID", count: 1 },
              { code: "FINDING_WARNING_COUNT_INVALID", count: 1 },
            ],
          },
        },
      });
      const mixedFindingOutcome = mixedCliReport.kinds.finding;
      if (
        mixedFindingOutcome?.status !== "published" ||
        typeof mixedFindingOutcome.generationId !== "string"
      ) {
        throw new Error("finding CLI returned no mixed-corpus generation id");
      }

      state.findings.clear();
      for (let index = 1; index <= 3; index += 1) {
        state.findings.set(`fs193-all-quarantined-${index}`, {
          id: `fs193-all-quarantined-${index}`,
          projectVersionId: mixedVersion,
          findingId: `CVE-2026-1931${index}`,
          title: `remote-authored-secret-${index}`,
          component: {
            id: `fs193-invalid-component-${index}`,
            version: "",
          },
        });
      }
      const allQuarantinedPull = async () =>
        rpcContract.syncPull.output.parse(
          await host.harness.behavior.callRpc("syncPull", {
            workspaceProjectId: "bb-project-sync",
            projectId: scope.projectId,
            projectVersionId: mixedVersion,
            kinds: ["finding"],
          }),
        );
      await expect(allQuarantinedPull()).resolves.toMatchObject({
        kinds: {
          finding: {
            status: "failed",
            generationId: expect.any(String),
            acceptedAt: null,
            fetched: 3,
            baseRows: 0,
            quarantined: 3,
            reasons: [{ code: "FINDING_ALL_ROWS_QUARANTINED", count: 3 }],
          },
        },
      });
      const failedGeneration = context
        .db()
        .prepare(
          `SELECT state.staging_generation_id AS generationId, generation.status
             FROM sync_state AS state
             JOIN pull_generation AS generation
               ON generation.project_id = state.project_id
              AND generation.project_version_id = state.project_version_id
              AND generation.generation_id = state.staging_generation_id
            WHERE state.project_id = ? AND state.project_version_id = ?
              AND state.entity_kind = 'finding'`,
        )
        .get(scope.projectId, mixedVersion) as
        | { generationId: string; status: string }
        | undefined;
      expect(failedGeneration).toMatchObject({ status: "failed" });
      expect(failedGeneration?.generationId).not.toBe(
        mixedFindingOutcome.generationId,
      );
      const acceptedAfterFailure = context
        .db()
        .prepare(
          `SELECT state.accepted_generation_id AS acceptedGenerationId,
                  COUNT(findings.finding_id) AS visibleRows
             FROM sync_state AS state
             LEFT JOIN findings
               ON findings.project_id = state.project_id
              AND findings.project_version_id = state.project_version_id
              AND findings.generation_id = state.accepted_generation_id
            WHERE state.project_id = ? AND state.project_version_id = ?
              AND state.entity_kind = 'finding'
            GROUP BY state.accepted_generation_id`,
        )
        .get(scope.projectId, mixedVersion);
      expect(acceptedAfterFailure).toEqual({
        acceptedGenerationId: mixedFindingOutcome.generationId,
        visibleRows: 3,
      });
      expect(JSON.stringify(host.harness.inspection.logEntries)).not.toContain(
        "remote-authored-secret",
      );

      state.findings.clear();
      state.findings.set("fs193-repaired", {
        id: "fs193-repaired",
        projectVersionId: mixedVersion,
        findingId: "CVE-2026-19320",
        component: {
          id: "fs193-repaired-component",
          name: "repaired-library",
          version: "2",
        },
      });
      const recovered = await allQuarantinedPull();
      expect(recovered).toMatchObject({
        kinds: {
          finding: {
            status: "published",
            fetched: 1,
            baseRows: 1,
            quarantined: 0,
          },
        },
      });
      const recoveredFinding = recovered.kinds.finding;
      if (recoveredFinding?.status !== "published") {
        throw new Error("syncPull returned no recovered generation id");
      }
      const recoveredGenerationId = recoveredFinding.generationId;
      expect(recoveredGenerationId).not.toBe(failedGeneration?.generationId);
      expect(
        context
          .db()
          .prepare(
            `SELECT state.accepted_generation_id AS acceptedGenerationId,
                    COUNT(findings.finding_id) AS visibleRows
               FROM sync_state AS state
               LEFT JOIN findings
                 ON findings.project_id = state.project_id
                AND findings.project_version_id = state.project_version_id
                AND findings.generation_id = state.accepted_generation_id
              WHERE state.project_id = ? AND state.project_version_id = ?
                AND state.entity_kind = 'finding'
              GROUP BY state.accepted_generation_id`,
          )
          .get(scope.projectId, mixedVersion),
      ).toEqual({
        acceptedGenerationId: recoveredGenerationId,
        visibleRows: 1,
      });

      const originalGetFindings = platform.getFindings;
      const continuations: Array<string | undefined> = [];
      platform.getFindings = (
        input,
      ): AsyncIterable<RemotePage<Record<string, Json>>> => ({
        async *[Symbol.asyncIterator]() {
          continuations.push(input.page?.continuation);
          if (input.page?.continuation === undefined) {
            yield {
              items: [
                {
                  id: "fs193-resume-quarantined",
                  projectVersionId: mixedVersion,
                  findingId: "CVE-2026-19321",
                  component: {
                    id: "fs193-resume-invalid-component",
                    version: "",
                  },
                },
              ],
              total: 1,
              next: "after-quarantine",
            };
            throw new Error("FS193_RETRYABLE_INTERRUPT");
          }
          yield { items: [], total: 1, next: null };
        },
      });
      try {
        await expect(allQuarantinedPull()).resolves.toMatchObject({
          kinds: {
            finding: {
              status: "failed",
              generationId: expect.any(String),
              fetched: 1,
              baseRows: 0,
              quarantined: 1,
              reasons: [{ code: "FS193_RETRYABLE_INTERRUPT", count: 1 }],
            },
          },
        });
        const resumable = context
          .db()
          .prepare(
            `SELECT state.staging_generation_id AS generationId,
                    state.staging_continuation AS continuation,
                    state.staged_rows AS rows,
                    state.staged_quarantined AS quarantined,
                    generation.status
               FROM sync_state AS state
               JOIN pull_generation AS generation
                 ON generation.project_id = state.project_id
                AND generation.project_version_id = state.project_version_id
                AND generation.generation_id = state.staging_generation_id
              WHERE state.project_id = ? AND state.project_version_id = ?
                AND state.entity_kind = 'finding'`,
          )
          .get(scope.projectId, mixedVersion) as {
          generationId: string;
          continuation: string;
          rows: number;
          quarantined: number;
          status: string;
        };
        expect(resumable).toEqual({
          generationId: expect.any(String),
          continuation: "after-quarantine",
          rows: 0,
          quarantined: 1,
          status: "staging",
        });

        await expect(allQuarantinedPull()).resolves.toMatchObject({
          kinds: {
            finding: {
              status: "failed",
              generationId: resumable.generationId,
              fetched: 1,
              baseRows: 0,
              quarantined: 1,
              reasons: [{ code: "FINDING_ALL_ROWS_QUARANTINED", count: 1 }],
            },
          },
        });
        expect(continuations).toEqual([undefined, "after-quarantine"]);
        expect(
          context
            .db()
            .prepare(
              `SELECT generation.status, state.accepted_generation_id AS acceptedGenerationId,
                      state.staging_generation_id AS stagingGenerationId
                 FROM sync_state AS state
                 JOIN pull_generation AS generation
                   ON generation.project_id = state.project_id
                  AND generation.project_version_id = state.project_version_id
                  AND generation.generation_id = state.staging_generation_id
                WHERE state.project_id = ? AND state.project_version_id = ?
                  AND state.entity_kind = 'finding'`,
            )
            .get(scope.projectId, mixedVersion),
        ).toEqual({
          status: "failed",
          acceptedGenerationId: recoveredGenerationId,
          stagingGenerationId: resumable.generationId,
        });
      } finally {
        platform.getFindings = originalGetFindings;
      }

      state.findings.clear();
      const empty = await allQuarantinedPull();
      expect(empty).toMatchObject({
        kinds: {
          finding: {
            status: "published",
            fetched: 0,
            baseRows: 0,
            quarantined: 0,
          },
        },
      });
      const emptyFinding = empty.kinds.finding;
      if (emptyFinding?.status !== "published") {
        throw new Error("syncPull returned no empty generation id");
      }
      const emptyGenerationId = emptyFinding.generationId;
      expect(emptyGenerationId).not.toBe(recoveredGenerationId);
      expect(
        context
          .db()
          .prepare(
            `SELECT state.accepted_generation_id AS acceptedGenerationId,
                    COUNT(findings.finding_id) AS visibleRows
               FROM sync_state AS state
               LEFT JOIN findings
                 ON findings.project_id = state.project_id
                AND findings.project_version_id = state.project_version_id
                AND findings.generation_id = state.accepted_generation_id
              WHERE state.project_id = ? AND state.project_version_id = ?
                AND state.entity_kind = 'finding'
              GROUP BY state.accepted_generation_id`,
          )
          .get(scope.projectId, mixedVersion),
      ).toEqual({
        acceptedGenerationId: emptyGenerationId,
        visibleRows: 0,
      });
    } finally {
      state.findings.clear();
      for (const [id, row] of originalFindings) state.findings.set(id, row);
      state.versions.delete(mixedVersion);
    }
  });

  it("isolates default-pull remote, quarantine, and unselected-AS failures through the registered CLI", async () => {
    const scope = platformScope();
    const cliContext = {
      cwd: root,
      threadId: "thread-sync-cli",
      projectId: "bb-project-sync",
    };
    const argv = [
      "pull",
      "--project",
      scope.projectId,
      "--version",
      scope.projectVersionId,
      "--json",
    ];
    bindWorkspacePlatformProject(
      context.db(),
      "bb-project-sync",
      scope.projectId,
    );
    context
      .db()
      .prepare(
        `UPDATE workspace_platform_project_binding
            SET assurance_studio_project_id = NULL
          WHERE workspace_project_id = ? AND platform_project_id = ?`,
      )
      .run("bb-project-sync", scope.projectId);

    const originalFindings = new Map(state.findings);
    const changedSignals = () =>
      host.harness.realtimeSignals.filter(
        (signal) =>
          signal.channel === "findings:changed" ||
          signal.channel === "requirements:changed" ||
          signal.channel === "tara:changed",
      );
    try {
      const beforeRemoteFailure = changedSignals().length;
      selectAssuranceStudioProjectBinding(
        context.db(),
        "bb-project-sync",
        scope.projectId,
        "as-project-explicit",
      );
      remoteRequirementError = new RemoteError(
        "Assurance Studio requirements unavailable",
        {
          service: "assurance-studio",
          code: "REMOTE_SERVER_ERROR",
          status: 503,
          retryable: true,
          retryAfterMs: null,
          details: null,
        },
      );
      const remoteFailure = await host.harness.behavior.runCli(
        argv,
        cliContext,
      );
      expect(remoteFailure).toMatchObject({ exitCode: 1, stderr: "" });
      const remoteReport = JSON.parse(
        remoteFailure.stdout,
      ) as IsolatedPullReport;
      expect(remoteReport.kinds.requirement).toMatchObject({
        status: "failed",
        generationId: expect.any(String),
        reasons: [{ code: "http", count: 1 }],
      });
      expect(remoteReport.kinds.vexDecision).toMatchObject({
        status: "published",
        generationId: expect.any(String),
      });
      expect(
        changedSignals()
          .slice(beforeRemoteFailure)
          .map((signal) => signal.channel),
      ).toEqual(["findings:changed"]);

      remoteRequirementError = null;
      context
        .db()
        .prepare(
          `UPDATE workspace_platform_project_binding
              SET assurance_studio_project_id = NULL
            WHERE workspace_project_id = ? AND platform_project_id = ?`,
        )
        .run("bb-project-sync", scope.projectId);
      state.findings.clear();
      for (let index = 1; index <= 3; index += 1) {
        state.findings.set(`fs196-quarantined-${index}`, {
          id: `fs196-quarantined-${index}`,
          projectVersionId: scope.projectVersionId,
          findingId: `CVE-2026-1960${index}`,
          component: { id: `invalid-${index}`, version: "" },
        });
      }
      const beforeQuarantine = changedSignals().length;
      const quarantineFailure = await host.harness.behavior.runCli(
        argv,
        cliContext,
      );
      expect(quarantineFailure).toMatchObject({ exitCode: 1, stderr: "" });
      const quarantineReport = JSON.parse(
        quarantineFailure.stdout,
      ) as IsolatedPullReport;
      expect(quarantineReport.kinds.finding).toEqual({
        status: "failed",
        generationId: expect.any(String),
        acceptedAt: null,
        fetched: 3,
        baseRows: 0,
        quarantined: 3,
        reasons: [{ code: "FINDING_ALL_ROWS_QUARANTINED", count: 3 }],
      });
      expect(quarantineReport.kinds.vexDecision).toMatchObject({
        status: "published",
      });
      expect(changedSignals()).toHaveLength(beforeQuarantine);

      state.findings.clear();
      for (const [id, row] of originalFindings) state.findings.set(id, row);
      const beforeUnselected = changedSignals().length;
      const unselected = await host.harness.behavior.runCli(argv, cliContext);
      expect(unselected).toMatchObject({ exitCode: 1, stderr: "" });
      const unselectedReport = JSON.parse(
        unselected.stdout,
      ) as IsolatedPullReport;
      expect(unselectedReport.kinds.requirement).toEqual({
        status: "failed",
        generationId: null,
        acceptedAt: null,
        fetched: 0,
        baseRows: 0,
        quarantined: 0,
        reasons: [{ code: "AS_PROJECT_SELECTION_REQUIRED", count: 1 }],
      });
      expect(unselectedReport.kinds.finding).toMatchObject({
        status: "published",
      });
      expect(unselectedReport.kinds.vexDecision).toMatchObject({
        status: "published",
      });
      const emitted = changedSignals().slice(beforeUnselected);
      expect(emitted.map((signal) => signal.channel)).toEqual([
        "findings:changed",
      ]);
    } finally {
      remoteRequirementError = null;
      state.findings.clear();
      for (const [id, row] of originalFindings) state.findings.set(id, row);
    }
  });

  it("delegates the firmware namespace without changing sync verb parsing", async () => {
    const result = await host.harness.behavior.runCli(
      ["finite-state", "firmware", "status", "pv-1", "--json"],
      { threadId: "thread-sync-cli", projectId: "bb-project-sync" },
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify({
        namespace: "firmware",
        argv: ["status", "pv-1", "--json"],
      })}\n`,
      stderr: "",
    });
  });

  it("delegates the additive bench verdict namespace without changing sync verbs", async () => {
    const result = await host.harness.behavior.runCli(
      [
        "finite-state",
        "bench",
        "verdict",
        "pv-1",
        "--digest",
        "a".repeat(64),
        "--json",
      ],
      { threadId: "thread-sync-cli", projectId: "bb-project-sync" },
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify({
        namespace: "bench",
        argv: ["verdict", "pv-1", "--digest", "a".repeat(64), "--json"],
      })}\n`,
      stderr: "",
    });
  });

  it("runs the registered triage drift namespace and keeps confirmation outside agent tools", async () => {
    const scope = platformScope();
    const usage = await host.harness.behavior.runCli(["finite-state"], {});
    expect(usage).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("triage"),
    });
    const refreshed = await host.harness.behavior.runCli(
      [
        "finite-state",
        "triage",
        "drift",
        "refresh",
        "--project",
        scope.projectId,
        "--version",
        scope.projectVersionId,
        "--json",
      ],
      { threadId: "thread-sync-cli", projectId: "bb-project-sync" },
    );
    expect(refreshed).toMatchObject({ exitCode: 0, stderr: "" });
    const refreshReport = JSON.parse(refreshed.stdout) as {
      runId: string;
      createdAt: string;
      unclassifiedCount: number;
    };
    expect(refreshReport).toMatchObject({
      runId: expect.stringMatching(/^drift-/u),
      createdAt: expect.any(String),
      unclassifiedCount: 0,
    });

    const vendorDocument = JSON.stringify({
      "@context": "https://openvex.dev/ns/v0.2.0",
      "@id": "https://vendor.test/vex/fs-147",
      statements: [],
    });
    const unscopedUpload = await host.harness.behavior.fetchHttp(
      "POST",
      "/findings/vendor-vex/document",
      {
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(vendorDocument)),
          "x-fs-vendor-file": encodeURIComponent("vendor/openvex.json"),
        },
        body: vendorDocument,
      },
    );
    expect(unscopedUpload.status).toBe(400);
    const uploaded = await host.harness.behavior.fetchHttp(
      "POST",
      "/findings/vendor-vex/document",
      {
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(vendorDocument)),
          "x-fs-vendor-file": encodeURIComponent("vendor/openvex.json"),
          "x-fs-workspace-project": "bb-project-sync",
          "x-fs-platform-project": scope.projectId,
          "x-fs-project-version": scope.projectVersionId,
        },
        body: vendorDocument,
      },
    );
    expect(uploaded.status).toBe(200);
    const staged = (await uploaded.json()) as { documentSha256: string };
    const preview = (await host.harness.behavior.callRpc(
      "triageVendorVexPreview",
      {
        projectId: "bb-project-sync",
        projectVersionId: scope.projectVersionId,
        pageSize: 100,
        continuation: null,
        documentSha256: staged.documentSha256,
        vendor: "Supplier",
      },
    )) as {
      importId: string;
      documentSha256: string;
      written: number;
    };
    expect(preview).toMatchObject({
      projectId: scope.projectId,
      projectVersionId: scope.projectVersionId,
      documentSha256: staged.documentSha256,
      written: 0,
    });
    await expect(
      host.harness.behavior.callRpc("triageVendorVexApply", {
        projectId: "bb-project-sync",
        projectVersionId: scope.projectVersionId,
        pageSize: 100,
        continuation: null,
        importId: preview.importId,
        expectedDocumentSha256: "f".repeat(64),
        overwrite: false,
      }),
    ).rejects.toThrow("VENDOR_DOCUMENT_CHANGED");
    await expect(
      host.harness.behavior.callRpc("triageVendorVexApply", {
        projectId: "bb-project-sync",
        projectVersionId: scope.projectVersionId,
        pageSize: 100,
        continuation: null,
        importId: preview.importId,
        expectedDocumentSha256: staged.documentSha256,
        overwrite: false,
      }),
    ).resolves.toMatchObject({
      importId: preview.importId,
      documentSha256: staged.documentSha256,
      written: 0,
    });

    const read = await host.harness.behavior.runCli(
      [
        "triage",
        "drift",
        "report",
        "--project",
        scope.projectId,
        "--version",
        scope.projectVersionId,
        "--json",
      ],
      { threadId: "thread-sync-cli", projectId: "bb-project-sync" },
    );
    expect(JSON.parse(read.stdout)).toMatchObject({
      runId: refreshReport.runId,
      createdAt: refreshReport.createdAt,
    });

    const refused = await host.harness.behavior.runCli(
      [
        "triage",
        "orphans",
        "prune",
        "--stable-key",
        "stable-1",
        "--expected-base",
        "a".repeat(64),
        "--project",
        scope.projectId,
        "--version",
        scope.projectVersionId,
      ],
      { threadId: "thread-sync-cli", projectId: "bb-project-sync" },
    );
    expect(refused).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("ORPHAN_BASE_STATE_CHANGED"),
    });
    const callerBoolean = await host.harness.behavior.runCli(
      ["triage", "orphans", "prune", "--confirm"],
      { threadId: "thread-sync-cli", projectId: "bb-project-sync" },
    );
    expect(callerBoolean).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("unknown option"),
    });
    const overwriteFlag = await host.harness.behavior.runCli(
      [
        "triage",
        "import-vex",
        "apply",
        "--import-id",
        preview.importId,
        "--expected-document-sha256",
        staged.documentSha256,
        "--overwrite",
        "--project",
        scope.projectId,
        "--version",
        scope.projectVersionId,
      ],
      { threadId: "thread-sync-cli", projectId: "bb-project-sync" },
    );
    expect(overwriteFlag).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("unknown option"),
    });
    const help = await host.harness.behavior.runCli(["triage", "--help"], {
      threadId: "thread-sync-cli",
      projectId: "bb-project-sync",
    });
    expect(help).toMatchObject({ exitCode: 0, stderr: "" });
    expect(help.stdout).not.toContain("--confirm");
    expect(help.stdout).not.toContain("--overwrite");
    const registeredUsage = host.harness.registrations.cli?.commands.find(
      (command) => command.name === "triage",
    )?.usage;
    expect(registeredUsage).toEqual(expect.any(String));
    for (const flag of [
      "--cursor",
      "--limit",
      "--json",
      "--vendor",
      "--import-id",
      "--expected-document-sha256",
      "--stable-key",
      "--expected-base",
      "--help",
    ]) {
      expect(registeredUsage).toContain(flag);
    }
    expect(registeredUsage).not.toContain("--confirm");
    expect(registeredUsage).not.toContain("--overwrite");
    expect(
      host.harness.inspection.registrations.agentTools.some((tool) =>
        /drift|orphan|vendor/iu.test(tool.name),
      ),
    ).toBe(false);
  });

  it("refuses CLI working-tree access without a bb thread identity", async () => {
    const result = await host.harness.behavior.runCli(
      ["status", "triage", "--json"],
      {
        cwd: root,
      },
    );
    expect(result).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr: expect.stringContaining("SYNC_EXECUTION_CONTEXT_REQUIRED"),
    });
  });
});
