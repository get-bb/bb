import assert from "node:assert/strict";
import { test } from "vitest";
import { acpArgv, CLAUDE_MANAGED, DEFAULT_PROVIDERS, DEVIN_CLI, DEVIN_OUTPOST, OPENCODE, providerById, providersForTarget, } from "./providers.ts";
test("the four required agents are registered by default", () => {
    for (const id of ["opencode", "devin-cli", "claude-managed", "devin-outpost"]) {
        assert.ok(providerById(id), `missing provider ${id}`);
    }
});
test("provider ids are unique", () => {
    const ids = DEFAULT_PROVIDERS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
});
test("opencode and Devin CLI launch as ACP subprocesses", () => {
    assert.deepEqual(acpArgv(OPENCODE), ["opencode", "acp"]);
    assert.deepEqual(acpArgv(DEVIN_CLI), ["devin", "acp"]);
});
test("every local-acp provider carries skill roots including the Opulent convention", () => {
    for (const provider of DEFAULT_PROVIDERS) {
        if (provider.providerClass !== "local-acp")
            continue;
        const roots = provider.launch.nativeSkillRoots;
        assert.ok(roots, `${provider.id} has no nativeSkillRoots`);
        const all = [...roots.user, ...roots.project].map((r) => r.path);
        assert.ok(all.includes(".agents/skills"), `${provider.id} does not resolve .agents/skills`);
    }
});
test("Claude Managed Agents splits the control plane from the sandbox worker", () => {
    assert.equal(CLAUDE_MANAGED.providerClass, "managed-session");
    assert.deepEqual(CLAUDE_MANAGED.workerEnv, [
        "ANTHROPIC_ENVIRONMENT_KEY",
        "ANTHROPIC_WORK_ID",
        "ANTHROPIC_SESSION_ID",
    ]);
    assert.equal(CLAUDE_MANAGED.controlPlane.createSession, "beta.sessions.create");
    assert.equal(CLAUDE_MANAGED.controlPlane.listEvents, "beta.sessions.events.list");
    assert.ok(!CLAUDE_MANAGED.executionTargets.includes("local"));
});
test("the Outpost worker is outbound-only and never yields token-level data", () => {
    assert.equal(DEVIN_OUTPOST.inboundPortRequired, false);
    assert.equal(DEVIN_OUTPOST.maxFidelity, "lifecycle");
});
test("no provider claims token fidelity yet", () => {
    for (const provider of DEFAULT_PROVIDERS) {
        assert.notEqual(provider.maxFidelity, "token", `${provider.id} claims token fidelity; only an Opulent-served model may`);
    }
});
test("providersForTarget filters by execution plane", () => {
    const local = providersForTarget("local").map((p) => p.id);
    assert.ok(local.includes("opencode"));
    assert.ok(local.includes("devin-cli"));
    assert.ok(!local.includes("claude-managed"));
    const modal = providersForTarget("modal").map((p) => p.id);
    assert.ok(modal.includes("claude-managed"));
    assert.ok(modal.includes("devin-outpost"));
});
test("every provider is reachable on at least one execution target", () => {
    for (const provider of DEFAULT_PROVIDERS) {
        assert.ok(provider.executionTargets.length > 0, `${provider.id} has no execution targets`);
    }
});
