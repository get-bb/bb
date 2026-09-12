import assert from "node:assert/strict";
import { test } from "node:test";

import type { HarborTask } from "../harbor/harbor.ts";
import {
  admitTask,
  feedbackFor,
  probeReward,
  screenBatch,
  type ProbeResult,
  type TaskProposal,
} from "./envauthor.ts";

function task(overrides: Partial<HarborTask> = {}): HarborTask {
  return {
    name: "fix-null-deref",
    org: "opulent",
    description: "Fix a null dereference in the parser",
    instruction: "The parser crashes on empty input. Make test_empty_input pass.",
    oracleDiff: "--- a/src/parse.py\n+++ b/src/parse.py\n@@\n-    return s[0]\n+    return s[0] if s else None\n",
    ...overrides,
  };
}

const BASE_FAILS: ProbeResult = {
  failToPass: { test_empty_input: false },
  passToPass: { test_basic: true },
};

const ORACLE_PASSES: ProbeResult = {
  failToPass: { test_empty_input: true },
  passToPass: { test_basic: true },
};

function proposal(overrides: Partial<TaskProposal> = {}): TaskProposal {
  return {
    task: task(),
    authoredBy: "sub-agent-1",
    baseProbe: BASE_FAILS,
    oracleProbe: ORACLE_PASSES,
    ...overrides,
  };
}

test("a well-formed task with observed base-fail and oracle-pass is admitted", () => {
  const admission = admitTask(proposal());
  assert.equal(admission.admitted, true);
  assert.deepEqual(admission.rejections, []);
  assert.equal(admission.baseReward, 0);
  assert.equal(admission.oracleReward, 1);
});

test("probeReward matches Harbor's f2p_rate * p2p_rate", () => {
  // Half the F2P pass, one of two P2P regressed: 0.5 * 0.5.
  const mixed: ProbeResult = {
    failToPass: { a: true, b: false },
    passToPass: { c: true, d: false },
  };
  assert.equal(probeReward(mixed), 0.25);

  // No P2P tests is a pass, not a zero — matching the verifier's [1.0 if no P2P].
  assert.equal(probeReward({ failToPass: { a: true }, passToPass: {} }), 1);
});

test("a task whose F2P tests already pass is rejected as free reward", () => {
  const admission = admitTask(
    proposal({ baseProbe: { failToPass: { test_empty_input: true }, passToPass: { test_basic: true } } }),
  );
  assert.equal(admission.admitted, false);
  assert.ok(admission.rejections.some((r) => r.code === "trivially_passing"));
});

test("a task the oracle cannot solve is rejected", () => {
  const admission = admitTask(
    proposal({ oracleProbe: { failToPass: { test_empty_input: false }, passToPass: { test_basic: true } } }),
  );
  assert.equal(admission.admitted, false);
  assert.ok(admission.rejections.some((r) => r.code === "oracle_fails"));
});

test("an oracle that breaks the regression guard is rejected", () => {
  const admission = admitTask(
    proposal({ oracleProbe: { failToPass: { test_empty_input: true }, passToPass: { test_basic: false } } }),
  );
  assert.equal(admission.admitted, false);
  assert.ok(admission.rejections.some((r) => r.code === "oracle_regresses"));
});

test("a task with no fail-to-pass tests cannot distinguish a solution from a no-op", () => {
  const admission = admitTask(
    proposal({
      baseProbe: { failToPass: {}, passToPass: { test_basic: true } },
      oracleProbe: { failToPass: {}, passToPass: { test_basic: true } },
    }),
  );
  assert.equal(admission.admitted, false);
  assert.ok(admission.rejections.some((r) => r.code === "no_f2p_tests"));
});

test("a verifier that did not complete is never read as a result", () => {
  // The dangerous failure: an errored verifier reports no passing F2P, which looks
  // exactly like a correctly-failing base run. It must be rejected, not admitted.
  const admission = admitTask(
    proposal({
      baseProbe: { ...BASE_FAILS, verifierErrored: true, detail: "image build failed" },
    }),
  );
  assert.equal(admission.admitted, false);
  assert.ok(admission.rejections.some((r) => r.code === "verifier_errored"));
  assert.match(feedbackFor(admission), /image build failed/);
});

test("an empty oracle diff or instruction is rejected", () => {
  const noDiff = admitTask(proposal({ task: task({ oracleDiff: "   " }) }));
  assert.ok(noDiff.rejections.some((r) => r.code === "empty_oracle_diff"));

  const noInstruction = admitTask(proposal({ task: task({ instruction: "" }) }));
  assert.ok(noInstruction.rejections.some((r) => r.code === "missing_instruction"));
});

test("every failing check is reported, not just the first", () => {
  // An author agent fixing one problem per round trip is the slow path.
  const admission = admitTask(
    proposal({
      task: task({ oracleDiff: "" }),
      baseProbe: { failToPass: { t: true }, passToPass: {} },
      oracleProbe: { failToPass: { t: false }, passToPass: { guard: false } },
    }),
  );
  const codes = admission.rejections.map((r) => r.code).sort();
  assert.deepEqual(codes, [
    "empty_oracle_diff",
    "oracle_fails",
    "oracle_regresses",
    "trivially_passing",
  ]);
});

test("identical tasks are deduplicated by content hash", () => {
  const a = proposal();
  const b = proposal({ authoredBy: "sub-agent-2" }); // same instruction + diff
  const report = screenBatch([a, b]);

  assert.equal(report.admitted.length, 1);
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.rejected.length, 0);
});

test("a differing instruction is a different task", () => {
  const a = proposal();
  const b = proposal({ task: task({ instruction: "Different task entirely." }) });
  const report = screenBatch([a, b]);
  assert.equal(report.admitted.length, 2);
  assert.equal(report.duplicates.length, 0);
});

test("the batch report exposes the admission rate", () => {
  const good = proposal();
  const bad = proposal({
    baseProbe: { failToPass: { test_empty_input: true }, passToPass: {} },
  });
  const report = screenBatch([good, bad]);

  assert.equal(report.admitted.length, 1);
  assert.equal(report.rejected.length, 1);
  assert.equal(report.admissionRate, 0.5);
});

test("an empty batch has a defined admission rate", () => {
  const report = screenBatch([]);
  assert.equal(report.admissionRate, 0);
  assert.deepEqual(report.admitted, []);
});

test("feedback is actionable text naming each rejection code", () => {
  const admission = admitTask(
    proposal({ oracleProbe: { failToPass: { test_empty_input: false }, passToPass: { test_basic: true } } }),
  );
  const feedback = feedbackFor(admission);
  assert.match(feedback, /\[oracle_fails\]/);
  assert.match(feedback, /test_empty_input/);
  assert.equal(feedbackFor(admitTask(proposal())), "admitted");
});
