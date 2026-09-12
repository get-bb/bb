import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { contentHash, emitHarborTask, HarborEmitError, renderTaskToml, seedReproducibility, type HarborTask, } from "./harbor.ts";
const liteTask: HarborTask = {
    name: "opulent__fix-null-deref",
    org: "opulent",
    description: "Fix a null dereference in the config loader",
    instruction: "The config loader crashes on an empty file. Make it return defaults.",
    oracleDiff: "--- a/src/config.py\n+++ b/src/config.py\n@@\n-    return data\n+    return data or {}\n",
    keywords: ["python", "bugfix"],
};
const runtimeTask: HarborTask = {
    ...liteTask,
    name: "opulent__fix-null-deref-runtime",
    environmentDockerfile: "FROM python:3.12-slim-bookworm\nRUN pip install pytest\n",
    testScript: "#!/bin/bash\nset -euo pipefail\npytest -q\n",
    auxFiles: { "tests/f2p.json": '["tests/test_config.py::test_empty"]' },
    provenance: { pipeline: "pr_runtime", source_repo: "opulent/example", pr_number: 42 },
};
test("contentHash matches Repo2RLEnv's instruction + NUL + diff digest", () => {
    const expected = createHash("sha256")
        .update(Buffer.from(liteTask.instruction, "utf8"))
        .update(Buffer.from([0]))
        .update(Buffer.from(liteTask.oracleDiff, "utf8"))
        .digest("hex");
    assert.equal(contentHash(liteTask), `sha256:${expected}`);
});
test("a lite task declares only diff_similarity", () => {
    const toml = renderTaskToml(liteTask);
    assert.match(toml, /^version = "1\.0"$/m);
    assert.match(toml, /^name = "opulent\/opulent__fix-null-deref"$/m);
    assert.match(toml, /^reward_kinds = \["diff_similarity"\]$/m);
    assert.match(toml, /^spec_version = "0\.2\.0"$/m);
    assert.doesNotMatch(toml, /reproducibility/);
    assert.match(toml, /^\[agent\]\ntimeout_sec = 1800$/m);
    assert.match(toml, /^\[verifier\]\ntimeout_sec = 300$/m);
});
test("a runtime task declares test_execution first and seeds reproducibility", () => {
    const toml = renderTaskToml(runtimeTask);
    assert.match(toml, /^reward_kinds = \["test_execution", "diff_similarity"\]$/m);
    assert.match(toml, /^\[metadata\.repo2env\.reproducibility\]$/m);
    assert.match(toml, /^mode = "local_only"$/m);
    assert.match(toml, /^image_ref = "python:3\.12-slim-bookworm"$/m);
    assert.match(toml, /^image_visibility = "private"$/m);
    assert.match(toml, /^pipeline = "pr_runtime"$/m);
    assert.match(toml, /^pr_number = 42$/m);
});
test("seedReproducibility falls back when no FROM line exists", () => {
    const repro = seedReproducibility("# no from line here\nRUN true\n");
    assert.equal(repro.imageRef, "local/r2e-bootstrap:unknown");
    assert.equal(repro.mode, "local_only");
});
test("task name must be a slug, not an org-qualified path", () => {
    assert.throws(() => renderTaskToml({ ...liteTask, name: "opulent/thing" }), HarborEmitError);
});
test("emitHarborTask writes the lite layout with an executable solve.sh", () => {
    const files = emitHarborTask(liteTask);
    const byPath = new Map(files.map((f) => [f.path, f]));
    assert.deepEqual([...byPath.keys()].sort(), [
        "opulent__fix-null-deref/instruction.md",
        "opulent__fix-null-deref/solution/patch.diff",
        "opulent__fix-null-deref/solution/solve.sh",
        "opulent__fix-null-deref/task.toml",
    ]);
    const solve = byPath.get("opulent__fix-null-deref/solution/solve.sh");
    assert.ok(solve);
    assert.equal(solve.mode, 0o755);
    assert.match(solve.content, /^#!\/bin\/bash$/m);
    assert.match(solve.content, /git apply --verbose --reject "\$PATCH"/);
    const instruction = byPath.get("opulent__fix-null-deref/instruction.md");
    assert.equal(instruction?.content, liteTask.instruction);
});
test("emitHarborTask adds environment, tests and aux files for a runtime task", () => {
    const files = emitHarborTask(runtimeTask);
    const byPath = new Map(files.map((f) => [f.path, f]));
    const dir = "opulent__fix-null-deref-runtime";
    assert.ok(byPath.has(`${dir}/environment/Dockerfile`));
    const testSh = byPath.get(`${dir}/tests/test.sh`);
    assert.ok(testSh);
    assert.equal(testSh.mode, 0o755);
    const f2p = byPath.get(`${dir}/tests/f2p.json`);
    assert.ok(f2p);
    assert.equal(f2p.mode, 0o644);
});
test("aux files may not escape the task directory", () => {
    for (const bad of ["../escape.txt", "/etc/passwd", "nested/../../out.txt"]) {
        assert.throws(() => emitHarborTask({ ...liteTask, auxFiles: { [bad]: "x" } }), HarborEmitError, `expected rejection for ${bad}`);
    }
});
test("strings with quotes and newlines stay valid TOML basic strings", () => {
    const toml = renderTaskToml({
        ...liteTask,
        description: 'He said "hi"\nthen left\\',
    });
    assert.match(toml, /^description = "He said \\"hi\\"\\nthen left\\\\"$/m);
});
