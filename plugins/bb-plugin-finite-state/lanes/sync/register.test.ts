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
import type {
  Json,
  RemotePage,
  RemoteServices,
} from "../../lib/remote/types.js";
import { ENTITIES, parseFindingStableKey } from "../../lib/sync/registry.js";
import { registerFindings } from "../findings/register.js";
import {
  createMockRemote,
  type MockRemoteHarness,
} from "../../test/mock-remote/server.js";
import { registerPlatformHandlers } from "../../test/mock-remote/platform/register.js";
import {
  createMockPlatformState,
  type MockPlatformState,
} from "../../test/mock-remote/platform/state.js";
import { createSerializer } from "./serialize/serializer.js";
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

const foreignAdapter: EntityAdapter = {
  kind: "requirement",
  klass: "VERSIONED",
  serializer: createSerializer("requirement"),
  async *fetchRemote(_scope, progress) {
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

    const pulled = await host.harness.behavior.callRpc("syncPull", {
      ...scope,
      workspaceProjectId: "bb-project-sync",
      kinds: ["requirement", "vexDecision"],
    });
    expect(pulled).toMatchObject({
      ...scope,
      generationId: expect.any(String),
      baseStateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      kinds: {
        requirement: { fetched: 1, baseRows: 1, quarantined: 0 },
        vexDecision: {
          fetched: expect.any(Number),
          baseRows: expect.any(Number),
          quarantined: expect.any(Number),
        },
      },
    });
    if (
      typeof pulled !== "object" ||
      pulled === null ||
      !("generationId" in pulled) ||
      typeof pulled.generationId !== "string"
    ) {
      throw new Error("syncPull returned no generation id");
    }
    const pulledGenerationId = pulled.generationId;
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

    remoteRequirementError = new Error("registered RPC pull failed");
    try {
      await expect(
        host.harness.behavior.callRpc("syncPull", {
          ...scope,
          workspaceProjectId: "bb-project-failed-sync",
          kinds: ["requirement"],
        }),
      ).rejects.toThrow("registered RPC pull failed");
    } finally {
      remoteRequirementError = null;
    }
    expect(
      context
        .db()
        .prepare(
          `SELECT COUNT(*)
             FROM workspace_platform_project_binding
            WHERE workspace_project_id = ?`,
        )
        .pluck()
        .get("bb-project-failed-sync"),
    ).toBe(0);
    const statusReport = await host.harness.behavior.callRpc("syncStatus", {
      ...scope,
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
        requirement: pulledGenerationId,
        vexDecision: pulledGenerationId,
      },
      cache: { acceptedGenerationId: pulledGenerationId },
    });
    await expect(
      host.harness.behavior.callRpc("syncPlan", scope),
    ).resolves.toMatchObject({
      ...scope,
      planId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/u),
      planSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      baseGenerationIds: {
        requirement: pulledGenerationId,
        vexDecision: pulledGenerationId,
      },
      items: expect.any(Array),
      total: expect.any(Number),
      staleness: { degraded: true },
      cache: {
        state: "stale",
        message:
          "Working tree unavailable; plan includes upstream changes only",
        acceptedGenerationId: pulledGenerationId,
      },
    });
    const firstFilteredPage = await host.harness.behavior.callRpc("syncPlan", {
      ...scope,
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
    expect(JSON.parse(result.stdout)).toMatchObject({
      advisories: [],
      kinds: {
        vexDecision: {
          fetched: expect.any(Number),
          baseRows: expect.any(Number),
          quarantined: 0,
        },
      },
    });
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
    expect(host.harness.sdk.callsTo("threads.get")).toHaveLength(2);
    expect(host.harness.sdk.callsTo("environments.get")).toHaveLength(2);
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
        advisories: [
          {
            kind: "vexDecision",
            code: "VEX_REMOTE_IDENTITY_MISSING",
            count: 1,
          },
        ],
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
        finding: { fetched: 4_001, baseRows: 4_000, quarantined: 0 },
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
        finding: { fetched: 4_001, baseRows: 4_000, quarantined: 0 },
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
      },
      {
        projectId: "5d78bed3-fa8e-59cf-b8a1-6046853ba785",
        projectVersionId: "89ad8a41-2185-5df0-968b-c250312c908b",
        findingId: "85c04807-db47-4853-b659-ece4214ef395",
        cve: "CVE-2026-34877",
        componentGroup: null,
        componentName: "Mbed TLS",
        componentVersion: "3.0.0",
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
        kinds: { finding: { fetched: 1, baseRows: 1, quarantined: 0 } },
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
    const mixedRows = [
      {
        id: "fs193-binary-sast",
        projectVersionId: mixedVersion,
        findingId: "FS-500-006",
        component: {
          id: "fs193-component",
          name: "/update/firmware-root/etc/ssl/certs/ca-certificates.crt",
          version: "",
        },
        type: "binary-sast",
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
        id: "fs193-quarantined",
        projectVersionId: mixedVersion,
        findingId: "CVE-2026-19301",
        title: "https://remote.invalid/?token=must-not-reach-diagnostics",
        component: { id: "fs193-invalid-component", version: "" },
      },
    ];
    for (const row of mixedRows) state.findings.set(row.id, row);
    try {
      const mixed = await host.harness.behavior.callRpc("syncPull", {
        workspaceProjectId: "bb-project-sync",
        projectId: scope.projectId,
        projectVersionId: mixedVersion,
        kinds: ["finding"],
      });
      expect(mixed).toMatchObject({
        kinds: { finding: { fetched: 3, baseRows: 2, quarantined: 1 } },
      });
      if (
        typeof mixed !== "object" ||
        mixed === null ||
        !("generationId" in mixed) ||
        typeof mixed.generationId !== "string"
      ) {
        throw new Error("syncPull returned no mixed-corpus generation id");
      }
      const persisted = context
        .db()
        .prepare(
          `SELECT finding_id AS findingId, stable_key AS stableKey
             FROM findings
            WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
            ORDER BY finding_id`,
        )
        .all(scope.projectId, mixedVersion, mixed.generationId) as Array<{
        findingId: string;
        stableKey: string;
      }>;
      expect(persisted.map((row) => row.findingId)).toEqual([
        "fs193-binary-sast",
        "fs193-exact",
      ]);
      expect(parseFindingStableKey(persisted[0]?.stableKey ?? "").tier).toBe(
        "name-group-any-version",
      );
      expect(host.harness.inspection.logEntries).toContainEqual({
        level: "warn",
        message: "Quarantined individually unkeyable Platform finding rows: 1",
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
      const mixedCliReport: unknown = JSON.parse(mixedCli.stdout);
      expect(mixedCliReport).toMatchObject({
        kinds: { finding: { fetched: 3, baseRows: 2, quarantined: 1 } },
      });
      if (
        typeof mixedCliReport !== "object" ||
        mixedCliReport === null ||
        !("generationId" in mixedCliReport) ||
        typeof mixedCliReport.generationId !== "string"
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
      const allQuarantinedPull = () =>
        host.harness.behavior.callRpc("syncPull", {
          workspaceProjectId: "bb-project-sync",
          projectId: scope.projectId,
          projectVersionId: mixedVersion,
          kinds: ["finding"],
        });
      const allQuarantinedFailure = {
        code: "handler_error",
        message: expect.stringContaining(
          "finding: FINDING_ALL_ROWS_QUARANTINED: quarantined 3 fetched finding rows; reasons [FINDING_COMPONENT_IDENTITY_MISSING=3]",
        ),
      };
      await expect(allQuarantinedPull()).rejects.toMatchObject(
        allQuarantinedFailure,
      );
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
        mixedCliReport.generationId,
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
        acceptedGenerationId: mixedCliReport.generationId,
        visibleRows: 2,
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
        kinds: { finding: { fetched: 1, baseRows: 1, quarantined: 0 } },
      });
      if (
        typeof recovered !== "object" ||
        recovered === null ||
        !("generationId" in recovered) ||
        typeof recovered.generationId !== "string"
      ) {
        throw new Error("syncPull returned no recovered generation id");
      }
      expect(recovered.generationId).not.toBe(failedGeneration?.generationId);
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
        acceptedGenerationId: recovered.generationId,
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
        await expect(allQuarantinedPull()).rejects.toMatchObject({
          code: "handler_error",
          message: expect.stringContaining("FS193_RETRYABLE_INTERRUPT"),
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

        await expect(allQuarantinedPull()).rejects.toMatchObject({
          code: "handler_error",
          message: expect.stringContaining(
            "finding: FINDING_ALL_ROWS_QUARANTINED: quarantined 1 fetched finding rows; reasons [FINDING_PRIOR_INVOCATION_QUARANTINE=1]",
          ),
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
          acceptedGenerationId: recovered.generationId,
          stagingGenerationId: resumable.generationId,
        });
      } finally {
        platform.getFindings = originalGetFindings;
      }

      state.findings.clear();
      const empty = await allQuarantinedPull();
      expect(empty).toMatchObject({
        kinds: { finding: { fetched: 0, baseRows: 0, quarantined: 0 } },
      });
      if (
        typeof empty !== "object" ||
        empty === null ||
        !("generationId" in empty) ||
        typeof empty.generationId !== "string"
      ) {
        throw new Error("syncPull returned no empty generation id");
      }
      expect(empty.generationId).not.toBe(recovered.generationId);
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
        acceptedGenerationId: empty.generationId,
        visibleRows: 0,
      });
    } finally {
      state.findings.clear();
      for (const [id, row] of originalFindings) state.findings.set(id, row);
      state.versions.delete(mixedVersion);
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
