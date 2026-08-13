import { lstat, mkdtemp, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readVexWorking } from "../../sync/entities/vex-decision.js";
import { parseOverlay, stableKeyFor, type DecisionInput } from "./schema.js";
import {
  OVERLAY_LOCK_STALE_MS,
  OverlayCasConflictError,
  removeDecision,
  setDecision,
} from "./writer.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "fs-overlay-writer-")));
  roots.push(directory);
  return directory;
}

function input(cve = "CVE-2026-100", overrides: Partial<DecisionInput> = {}): DecisionInput {
  const component = {
    purl: "pkg:generic/busybox@1.36.1",
    name: "busybox",
    group: null,
    version: "1.36.1",
  };
  return {
    project: "project-1",
    component,
    cve,
    stableKey: stableKeyFor("project-1", component, cve),
    status: "IN_TRIAGE",
    justification: null,
    response: null,
    reason: "investigating call paths",
    pin: "exact_version",
    provenance: {
      by: "bb-agent",
      at: "2026-08-13T08:00:00.000Z",
      evidence: "scanner finding and call graph retained",
    },
    sync: {
      base: { status: null, justification: null, response: null, reason: null },
      pushed_at: null,
    },
    ...overrides,
  };
}

describe("triage overlay writer", () => {
  it("creates, updates, and removes deterministic bytes while merging decisions", async () => {
    const projectRoot = await root();
    const first = await setDecision(projectRoot, input());
    const initialBytes = await readFile(join(projectRoot, first.file), "utf8");
    const noop = await setDecision(projectRoot, input(), first.afterSha256);
    expect(noop.afterSha256).toBe(first.afterSha256);
    expect(await readFile(join(projectRoot, first.file), "utf8")).toBe(initialBytes);

    const second = await setDecision(projectRoot, input("CVE-2026-200"), noop.afterSha256);
    const merged = await readFile(join(projectRoot, second.file), "utf8");
    expect(merged).toContain("CVE-2026-100:");
    expect(merged).toContain("CVE-2026-200:");
    const semanticPayload = [
      {
        key: input().stableKey,
        file: second.file,
        payload: {
          status: "IN_TRIAGE",
          justification: null,
          response: null,
          reason: "investigating call paths",
        },
      },
      {
        key: input("CVE-2026-200").stableKey,
        file: second.file,
        payload: {
          status: "IN_TRIAGE",
          justification: null,
          response: null,
          reason: "investigating call paths",
        },
      },
    ].sort((left, right) => left.key.localeCompare(right.key));
    expect(await readVexWorking(projectRoot)).toEqual(semanticPayload);

    const removed = await removeDecision(projectRoot, {
      project: "project-1",
      component: input().component,
      cve: "CVE-2026-100",
      stableKey: input().stableKey,
    }, second.afterSha256);
    const remaining = await readFile(join(projectRoot, removed.file), "utf8");
    expect(remaining).not.toContain("CVE-2026-100:");
    expect(remaining).toContain("CVE-2026-200:");
  });

  it("forces CODE_NOT_REACHABLE to exact-version pinning", async () => {
    const projectRoot = await root();
    const forced = await setDecision(projectRoot, input("CVE-2026-300", {
      status: "NOT_AFFECTED",
      justification: "CODE_NOT_REACHABLE",
      reason: "dead call path proved by the attached trace",
      pin: undefined,
    }));
    expect(await readFile(join(projectRoot, forced.file), "utf8")).toContain("pin: exact_version");
    await expect(setDecision(projectRoot, input("CVE-2026-301", {
      status: "NOT_AFFECTED",
      justification: "CODE_NOT_REACHABLE",
      reason: "dead call path proved by the attached trace",
      pin: "any_version",
    }))).rejects.toThrow(/cannot use any_version/u);
  });

  it("rejects traversal before creating an overlay path", async () => {
    const projectRoot = await root();
    const bad = input("CVE-2026-400", { project: "../escape" });
    await expect(setDecision(projectRoot, bad)).rejects.toThrow(/path-safe/u);
  });

  it("rejects untrusted schema fields, ephemeral ids, incomplete rationale, and invalid vocabulary", () => {
    const valid = {
      schema: "fs-triage/v1",
      project: "project-1",
      component: input().component,
      decisions: {
        "CVE-2026-400": {
          status: "IN_TRIAGE",
          justification: null,
          response: null,
          reason: "reviewing",
          pin: "exact_version",
          provenance: { by: "engineer", at: "2026-08-13T08:00:00.000Z", evidence: "trace" },
          sync: { base: null, pushed_at: null },
        },
      },
    };
    const invalid = [
      { ...valid, pvId: "pv-1" },
      { ...valid, owner: "unexpected" },
      { ...valid, decisions: { "CVE-2026-400": { ...valid.decisions["CVE-2026-400"], status: "UNKNOWN" } } },
      { ...valid, decisions: { "CVE-2026-400": { ...valid.decisions["CVE-2026-400"], reason: "" } } },
      { ...valid, decisions: { "CVE-2026-400": {
        ...valid.decisions["CVE-2026-400"],
        provenance: { ...valid.decisions["CVE-2026-400"].provenance, evidence: "" },
      } } },
      { ...valid, decisions: { "CVE-2026-400": {
        ...valid.decisions["CVE-2026-400"], status: "NOT_AFFECTED", justification: null,
      } } },
      { ...valid, decisions: { "CVE-2026-400": {
        ...valid.decisions["CVE-2026-400"],
        provenance: { ...valid.decisions["CVE-2026-400"].provenance, evidence: "123e4567-e89b-12d3-a456-426614174000" },
      } } },
    ];
    for (const value of invalid) expect(() => parseOverlay(value, "bad.yaml")).toThrow();
  });

  it("returns a recoverable CAS conflict without changing the winning bytes", async () => {
    const projectRoot = await root();
    const created = await setDecision(projectRoot, input());
    const winner = await setDecision(projectRoot, input("CVE-2026-500"), created.afterSha256);
    const winnerBytes = await readFile(join(projectRoot, winner.file), "utf8");
    const losingWrite = setDecision(projectRoot, input("CVE-2026-600"), created.afterSha256);
    await expect(losingWrite).rejects.toMatchObject({ code: "OVERLAY_CAS_CONFLICT" });
    await expect(losingWrite).rejects.toBeInstanceOf(OverlayCasConflictError);
    expect(await readFile(join(projectRoot, winner.file), "utf8")).toBe(winnerBytes);
  });

  it("reports active locks without host paths and reclaims stale crash locks", async () => {
    const projectRoot = await root();
    const created = await setDecision(projectRoot, input());
    const lock = join(projectRoot, `${created.file}.lock`);
    await writeFile(lock, "orphaned writer", "utf8");
    await expect(setDecision(projectRoot, input("CVE-2026-701"), created.afterSha256)).rejects.toMatchObject({
      code: "OVERLAY_LOCK_HELD",
      file: created.file,
    });
    const stale = new Date(Date.now() - OVERLAY_LOCK_STALE_MS - 1_000);
    await utimes(lock, stale, stale);
    await expect(setDecision(projectRoot, input("CVE-2026-701"), created.afterSha256)).resolves.toMatchObject({
      file: created.file,
    });
    await expect(lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps 200 sequential distinct-component writes bounded", async () => {
    const projectRoot = await root();
    const started = performance.now();
    for (let index = 0; index < 200; index += 1) {
      const cve = `CVE-2026-${10_000 + index}`;
      const component = { purl: null, name: `component-${index}`, group: null, version: "1" };
      await setDecision(projectRoot, {
        ...input(cve),
        component,
        stableKey: stableKeyFor("project-1", component, cve),
      });
    }
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
