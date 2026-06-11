// Route-level coverage for the per-project workflow policy (plan M7):
// GET returns the effective policy (built-in defaults without a row), PUT is
// a strict full replace, and the launch boundary consumes the policy — the
// sandbox ceiling gates POST /workflow-runs (422 over-ceiling, admitted once
// granted, ceiling snapshotted on the run row) and the budget default fills
// launches that carry no override.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { workflowRunResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import {
  requireRun,
  seedWorkflowFixture,
  WORKFLOW_SOURCE,
  type WorkflowFixture,
} from "../helpers/workflow-runs.js";

const apiErrorSchema = z.object({ code: z.string(), message: z.string() });

const policySchema = z
  .object({
    sandboxCeiling: z.enum([
      "read-only",
      "workspace-write",
      "danger-full-access",
    ]),
    defaultBudgetOutputTokens: z.number().int().positive().nullable(),
  })
  .strict();

async function getPolicy(
  harness: TestAppHarness,
  projectId: string,
): Promise<Response> {
  return harness.app.request(`/api/v1/projects/${projectId}/workflow-policy`);
}

async function putPolicy(
  harness: TestAppHarness,
  projectId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return harness.app.request(`/api/v1/projects/${projectId}/workflow-policy`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postWorkflowRun(
  harness: TestAppHarness,
  fixture: Pick<WorkflowFixture, "projectId">,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return harness.app.request("/api/v1/workflow-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: fixture.projectId,
      source: { type: "inline", script: WORKFLOW_SOURCE },
      ...extra,
    }),
  });
}

describe("/projects/:id/workflow-policy", () => {
  it("returns the built-in defaults without a row and round-trips a full replace", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "wf-policy-roundtrip");

      const initial = await getPolicy(harness, fixture.projectId);
      expect(initial.status).toBe(200);
      expect(policySchema.parse(await readJson(initial))).toEqual({
        sandboxCeiling: "workspace-write",
        defaultBudgetOutputTokens: null,
      });

      const granted = await putPolicy(harness, fixture.projectId, {
        sandboxCeiling: "danger-full-access",
        defaultBudgetOutputTokens: 40_000,
      });
      expect(granted.status).toBe(200);
      expect(policySchema.parse(await readJson(granted))).toEqual({
        sandboxCeiling: "danger-full-access",
        defaultBudgetOutputTokens: 40_000,
      });

      // Full replace: null budget means "no budget default", never "keep".
      const lowered = await putPolicy(harness, fixture.projectId, {
        sandboxCeiling: "read-only",
        defaultBudgetOutputTokens: null,
      });
      expect(lowered.status).toBe(200);
      const after = await getPolicy(harness, fixture.projectId);
      expect(policySchema.parse(await readJson(after))).toEqual({
        sandboxCeiling: "read-only",
        defaultBudgetOutputTokens: null,
      });
    });
  });

  it("rejects malformed payloads and unknown projects", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "wf-policy-invalid");

      const badCeiling = await putPolicy(harness, fixture.projectId, {
        sandboxCeiling: "anything-goes",
        defaultBudgetOutputTokens: null,
      });
      expect(badCeiling.status).toBe(400);

      // Strict schema: a partial update is rejected, not merged.
      const partial = await putPolicy(harness, fixture.projectId, {
        sandboxCeiling: "read-only",
      });
      expect(partial.status).toBe(400);

      expect((await getPolicy(harness, "proj_missing")).status).toBe(404);
      expect(
        (
          await putPolicy(harness, "proj_missing", {
            sandboxCeiling: "read-only",
            defaultBudgetOutputTokens: null,
          })
        ).status,
      ).toBe(404);
    });
  });

  it("gates launches: 422 over-ceiling by default, admitted once granted, ceiling snapshotted", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedWorkflowFixture(harness, "wf-policy-launch");

      const rejected = await postWorkflowRun(harness, fixture, {
        sandbox: "danger-full-access",
      });
      expect(rejected.status).toBe(422);
      expect(apiErrorSchema.parse(await readJson(rejected)).code).toBe(
        "workflow_sandbox_not_allowed",
      );

      await putPolicy(harness, fixture.projectId, {
        sandboxCeiling: "danger-full-access",
        defaultBudgetOutputTokens: 30_000,
      });

      const admitted = await postWorkflowRun(harness, fixture, {
        sandbox: "danger-full-access",
      });
      expect(admitted.status).toBe(201);
      const run = workflowRunResponseSchema.parse(await readJson(admitted));
      expect(run.sandbox).toBe("danger-full-access");
      // The project budget default filled the unoverridden launch.
      expect(run.budgetOutputTokens).toBe(30_000);
      // The ceiling snapshots onto the run row (resume rebuilds the daemon
      // command from it; a later policy change must not alter enforcement).
      expect(requireRun(harness, run.id).sandboxCeiling).toBe(
        "danger-full-access",
      );

      // A lowered ceiling applies to FUTURE launches only.
      await putPolicy(harness, fixture.projectId, {
        sandboxCeiling: "read-only",
        defaultBudgetOutputTokens: null,
      });
      expect(requireRun(harness, run.id).sandboxCeiling).toBe(
        "danger-full-access",
      );
      const nowRejected = await postWorkflowRun(harness, fixture, {
        sandbox: "workspace-write",
      });
      expect(nowRejected.status).toBe(422);

      // An explicit launch override still beats the project budget default.
      await putPolicy(harness, fixture.projectId, {
        sandboxCeiling: "workspace-write",
        defaultBudgetOutputTokens: 30_000,
      });
      const overridden = await postWorkflowRun(harness, fixture, {
        budgetOutputTokens: 5_000,
      });
      expect(overridden.status).toBe(201);
      expect(
        workflowRunResponseSchema.parse(await readJson(overridden))
          .budgetOutputTokens,
      ).toBe(5_000);
    });
  });
});
