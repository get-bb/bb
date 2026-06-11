import { describe, expect, it } from "vitest";
import { KEY_VERSION } from "@bb/workflow-runtime";
import { upsertProjectWorkflowPolicy } from "@bb/db";
import { ApiError } from "../../src/errors.js";
import { resolveProjectSourcePath } from "../../src/services/projects/project-source-path.js";
import {
  buildWorkflowRunCreateInput,
  getEffectiveProjectWorkflowPolicy,
  PROJECT_WORKFLOW_POLICY_DEFAULTS,
  resolveWorkflowRunDefaults,
  WORKFLOW_RUN_POLICY_DEFAULTS,
  type ProjectWorkflowPolicy,
} from "../../src/services/workflows/workflow-run-policy.js";
import { validateWorkflowScriptSource } from "../../src/services/workflows/workflow-registry.js";
import { seedHost, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const BARE_META: Parameters<typeof resolveWorkflowRunDefaults>[0]["meta"] = {
  name: "bare-flow",
  description: "A workflow without declared defaults",
};

const DEFAULT_POLICY: ProjectWorkflowPolicy = PROJECT_WORKFLOW_POLICY_DEFAULTS;

const WORKFLOW_SOURCE = `export const meta = {
  name: "policy-flow",
  description: "Policy resolution fixture",
  defaultModel: "fake-model",
  defaultSandbox: "workspace-write",
};

const result = await agent("Do the thing");
log(String(result));
`;

function expectSandboxRejected(args: {
  meta: Parameters<typeof resolveWorkflowRunDefaults>[0]["meta"];
  overrides: Parameters<typeof resolveWorkflowRunDefaults>[0]["overrides"];
  projectPolicy: ProjectWorkflowPolicy;
}): void {
  try {
    resolveWorkflowRunDefaults(args);
    throw new Error("expected sandbox ceiling validation to fail");
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    expect(error.status).toBe(422);
    expect(error.body.code).toBe("workflow_sandbox_not_allowed");
  }
}

describe("resolveWorkflowRunDefaults", () => {
  it("falls back to server policy when neither overrides nor meta declare values", () => {
    const defaults = resolveWorkflowRunDefaults({
      meta: BARE_META,
      overrides: {},
      projectPolicy: DEFAULT_POLICY,
    });

    expect(defaults).toEqual({
      providerId: WORKFLOW_RUN_POLICY_DEFAULTS.providerId,
      model: null,
      effort: WORKFLOW_RUN_POLICY_DEFAULTS.effort,
      sandbox: WORKFLOW_RUN_POLICY_DEFAULTS.sandbox,
      sandboxCeiling: DEFAULT_POLICY.sandboxCeiling,
      concurrency: WORKFLOW_RUN_POLICY_DEFAULTS.concurrency,
      maxAgents: WORKFLOW_RUN_POLICY_DEFAULTS.maxAgents,
      maxFanout: WORKFLOW_RUN_POLICY_DEFAULTS.maxFanout,
      budgetOutputTokens: null,
    });
  });

  it("prefers launch overrides over meta defaults over policy", () => {
    const defaults = resolveWorkflowRunDefaults({
      meta: {
        ...BARE_META,
        defaultProvider: "claude-code",
        defaultModel: "meta-model",
        defaultSandbox: "workspace-write",
      },
      overrides: {
        model: "override-model",
        effort: "high",
        budgetOutputTokens: 50_000,
      },
      projectPolicy: DEFAULT_POLICY,
    });

    expect(defaults.providerId).toBe("claude-code");
    expect(defaults.model).toBe("override-model");
    expect(defaults.effort).toBe("high");
    expect(defaults.sandbox).toBe("workspace-write");
    expect(defaults.budgetOutputTokens).toBe(50_000);
  });

  it("rejects a provider override outside the catalog with a 422 at the boundary", () => {
    try {
      resolveWorkflowRunDefaults({
        meta: BARE_META,
        overrides: { providerId: "not-a-provider" },
        projectPolicy: DEFAULT_POLICY,
      });
      throw new Error("expected provider validation to fail");
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      expect(error.status).toBe(422);
      expect(error.body.code).toBe("workflow_provider_unknown");
    }
    // Catalog providers pass through untouched.
    expect(
      resolveWorkflowRunDefaults({
        meta: BARE_META,
        overrides: { providerId: "pi" },
        projectPolicy: DEFAULT_POLICY,
      }).providerId,
    ).toBe("pi");
  });

  it("rejects danger-full-access under the default policy (no allowance granted)", () => {
    expectSandboxRejected({
      meta: BARE_META,
      overrides: { sandbox: "danger-full-access" },
      projectPolicy: DEFAULT_POLICY,
    });
    expectSandboxRejected({
      meta: { ...BARE_META, defaultSandbox: "danger-full-access" },
      overrides: {},
      projectPolicy: DEFAULT_POLICY,
    });
  });

  it("admits danger-full-access when the project ceiling grants it, snapshotting the ceiling", () => {
    const granting: ProjectWorkflowPolicy = {
      sandboxCeiling: "danger-full-access",
      defaultBudgetOutputTokens: null,
    };
    const fromOverride = resolveWorkflowRunDefaults({
      meta: BARE_META,
      overrides: { sandbox: "danger-full-access" },
      projectPolicy: granting,
    });
    expect(fromOverride.sandbox).toBe("danger-full-access");
    expect(fromOverride.sandboxCeiling).toBe("danger-full-access");

    const fromMeta = resolveWorkflowRunDefaults({
      meta: { ...BARE_META, defaultSandbox: "danger-full-access" },
      overrides: {},
      projectPolicy: granting,
    });
    expect(fromMeta.sandbox).toBe("danger-full-access");
  });

  it("rejects (never clamps) any resolved sandbox above a lowered ceiling", () => {
    const readOnlyOnly: ProjectWorkflowPolicy = {
      sandboxCeiling: "read-only",
      defaultBudgetOutputTokens: null,
    };
    expectSandboxRejected({
      meta: BARE_META,
      overrides: { sandbox: "workspace-write" },
      projectPolicy: readOnlyOnly,
    });
    expectSandboxRejected({
      meta: { ...BARE_META, defaultSandbox: "workspace-write" },
      overrides: {},
      projectPolicy: readOnlyOnly,
    });
    // The server default (read-only) still resolves under the lowered ceiling.
    expect(
      resolveWorkflowRunDefaults({
        meta: BARE_META,
        overrides: {},
        projectPolicy: readOnlyOnly,
      }).sandbox,
    ).toBe("read-only");
  });

  it("fills the budget from the project policy unless the launch overrides it", () => {
    const budgeted: ProjectWorkflowPolicy = {
      sandboxCeiling: "workspace-write",
      defaultBudgetOutputTokens: 75_000,
    };
    expect(
      resolveWorkflowRunDefaults({
        meta: BARE_META,
        overrides: {},
        projectPolicy: budgeted,
      }).budgetOutputTokens,
    ).toBe(75_000);
    expect(
      resolveWorkflowRunDefaults({
        meta: BARE_META,
        overrides: { budgetOutputTokens: 1_000 },
        projectPolicy: budgeted,
      }).budgetOutputTokens,
    ).toBe(1_000);
  });
});

describe("getEffectiveProjectWorkflowPolicy", () => {
  it("returns the built-in defaults without a row and the explicit row when set", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-wf-policy-row" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      expect(getEffectiveProjectWorkflowPolicy(harness.db, project.id)).toEqual(
        PROJECT_WORKFLOW_POLICY_DEFAULTS,
      );

      upsertProjectWorkflowPolicy(harness.db, {
        projectId: project.id,
        sandboxCeiling: "danger-full-access",
        defaultBudgetOutputTokens: 25_000,
      });
      expect(getEffectiveProjectWorkflowPolicy(harness.db, project.id)).toEqual(
        {
          sandboxCeiling: "danger-full-access",
          defaultBudgetOutputTokens: 25_000,
        },
      );

      // Full replace: lowering back clears the allowance and the budget.
      upsertProjectWorkflowPolicy(harness.db, {
        projectId: project.id,
        sandboxCeiling: "read-only",
        defaultBudgetOutputTokens: null,
      });
      expect(getEffectiveProjectWorkflowPolicy(harness.db, project.id)).toEqual(
        {
          sandboxCeiling: "read-only",
          defaultBudgetOutputTokens: null,
        },
      );
    });
  });
});

describe("buildWorkflowRunCreateInput", () => {
  it("fills every column explicitly from the resolved launch target", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-wf-policy" });
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/wf-policy-project",
      });
      const script = validateWorkflowScriptSource(WORKFLOW_SOURCE);
      const launchTarget = resolveProjectSourcePath(harness.deps, {
        projectId: project.id,
        hostId: null,
      });

      const input = buildWorkflowRunCreateInput({
        projectId: project.id,
        launchTarget,
        anchorThreadId: null,
        argsJson: '{"topic":"x"}',
        clientRequestId: null,
        overrides: {},
        projectPolicy: getEffectiveProjectWorkflowPolicy(
          harness.db,
          project.id,
        ),
        script,
        sourceTier: "inline",
      });

      expect(input.hostId).toBe(host.id);
      expect(input.workspacePath).toBe(source.path);
      expect(input.workflowName).toBe("policy-flow");
      expect(input.scriptSource).toBe(WORKFLOW_SOURCE);
      expect(input.scriptHash).toMatch(/^[0-9a-f]{64}$/);
      expect(input.argsJson).toBe('{"topic":"x"}');
      expect(input.keyVersion).toBe(KEY_VERSION);
      expect(Number.isInteger(input.seed)).toBe(true);
      expect(input.seed).toBeGreaterThanOrEqual(0);
      expect(input.model).toBe("fake-model");
      expect(input.sandbox).toBe("workspace-write");
      expect(input.sandboxCeiling).toBe(
        PROJECT_WORKFLOW_POLICY_DEFAULTS.sandboxCeiling,
      );
      expect(input.providerId).toBe(WORKFLOW_RUN_POLICY_DEFAULTS.providerId);
      expect(input.concurrency).toBe(WORKFLOW_RUN_POLICY_DEFAULTS.concurrency);
      expect(input.maxAgents).toBe(WORKFLOW_RUN_POLICY_DEFAULTS.maxAgents);
      expect(input.maxFanout).toBe(WORKFLOW_RUN_POLICY_DEFAULTS.maxFanout);
      expect(input.budgetOutputTokens).toBeNull();
    });
  });
});

describe("resolveProjectSourcePath (workflow launch target)", () => {
  it("409s when the project has no default source and 404s for an unknown explicit host", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-wf-policy-err" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      expect(() =>
        resolveProjectSourcePath(harness.deps, {
          projectId: "proj_missing",
          hostId: null,
        }),
      ).toThrowError(/no default source/);

      expect(() =>
        resolveProjectSourcePath(harness.deps, {
          projectId: project.id,
          hostId: "host-without-source",
        }),
      ).toThrowError(/no local-path source/);
    });
  });
});
