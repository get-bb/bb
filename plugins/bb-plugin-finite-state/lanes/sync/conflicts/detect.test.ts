import { describe, expect, it } from "vitest";

import {
  attributeConflicts,
  refinePlanConflicts,
  registerAttributionProvider,
} from "./attribution.js";
import { detectConflicts } from "./detect.js";
import { readPointer, writePointer } from "./merge.js";

const kind = "component" as const;
const key = "component-key";

describe("semantic conflict detection", () => {
  it("covers the scalar three-way matrix without confusing null and absence", () => {
    const cases = [
      { ours: "base", theirs: "base", merged: "base", conflicts: 0 },
      { ours: "ours", theirs: "base", merged: "ours", conflicts: 0 },
      { ours: "base", theirs: "theirs", merged: "theirs", conflicts: 0 },
      { ours: "same", theirs: "same", merged: "same", conflicts: 0 },
      { ours: "ours", theirs: "theirs", merged: "ours", conflicts: 1 },
      { ours: null, theirs: undefined, merged: null, conflicts: 1 },
    ] as const;
    for (const candidate of cases) {
      const result = detectConflicts({
        kind,
        key,
        base: { value: "base" },
        ours: candidate.ours === undefined ? {} : { value: candidate.ours },
        theirs: candidate.theirs === undefined ? {} : { value: candidate.theirs },
      });
      expect(result.conflicts).toHaveLength(candidate.conflicts);
      expect(readPointer(result.merged, "/value")).toEqual(
        candidate.merged === undefined
          ? { present: false, value: undefined }
          : { present: true, value: candidate.merged },
      );
    }

    const missingVsNull = detectConflicts({
      kind,
      key,
      base: { nested: "base" },
      ours: { nested: null },
      theirs: {},
    }).conflicts[0];
    expect(missingVsNull).toMatchObject({
      path: "/nested",
      base: "base",
      ours: null,
      classification: "delete-update",
    });
    expect(missingVsNull).toHaveProperty("theirs", undefined);
  });

  it("merges disjoint nested edits and conflicts at the exact shared pointer", () => {
    expect(detectConflicts({
      kind,
      key,
      base: { profile: { title: "base", owner: "alice" } },
      ours: { profile: { title: "ours", owner: "alice" } },
      theirs: { profile: { title: "base", owner: "bob" } },
    })).toEqual({
      merged: { profile: { owner: "bob", title: "ours" } },
      conflicts: [],
    });

    const conflict = detectConflicts({
      kind,
      key,
      base: { profile: { title: "base" } },
      ours: { profile: { title: "ours" } },
      theirs: { profile: { title: "theirs" } },
    }).conflicts[0];
    expect(conflict).toMatchObject({
      path: "/profile/title",
      base: "base",
      ours: "ours",
      theirs: "theirs",
      classification: "same-field",
      resolution: null,
    });

    expect(detectConflicts({
      kind,
      key,
      base: { "a/b": { "~key": "base" } },
      ours: { "a/b": { "~key": "ours" } },
      theirs: { "a/b": { "~key": "theirs" } },
    }).conflicts[0]?.path).toBe("/a~1b/~0key");
  });

  it("classifies entity create/create, delete/update, and type changes explicitly", () => {
    expect(detectConflicts({
      kind,
      key,
      base: undefined,
      ours: { title: "ours" },
      theirs: { title: "theirs" },
    }).conflicts[0]).toMatchObject({ path: "", classification: "create-create" });

    expect(detectConflicts({
      kind,
      key,
      base: { title: "base" },
      ours: undefined,
      theirs: { title: "theirs" },
    }).conflicts[0]).toMatchObject({ path: "", classification: "delete-update" });

    expect(detectConflicts({
      kind,
      key,
      base: { value: "base" },
      ours: { value: { nested: true } },
      theirs: { value: ["theirs"] },
    }).conflicts[0]).toMatchObject({ path: "/value", classification: "type-change" });
  });

  it("merges registered graph sets while ordered arrays remain atomic", () => {
    const graph = detectConflicts({
      kind: "attackPath",
      key: "route-a",
      base: { nodes: ["a", "b"], edges: ["a->b"] },
      ours: { nodes: ["a", "b", "c"], edges: ["a->b", "b->c"] },
      theirs: { nodes: ["a", "b", "d"], edges: ["a->b", "b->d"] },
    });
    expect(graph.conflicts).toEqual([]);
    expect(graph.merged).toEqual({
      edges: ["a->b", "b->c", "b->d"],
      nodes: ["a", "b", "c", "d"],
    });

    expect(detectConflicts({
      kind: "attackPath",
      key: "route-removals",
      base: { nodes: ["a", "b"] },
      ours: { nodes: ["a"] },
      theirs: { nodes: ["b"] },
    })).toEqual({ merged: { nodes: [] }, conflicts: [] });

    const opposed = detectConflicts({
      kind: "attackPath",
      key: "route-opposed",
      base: { nodes: [{ id: "a", label: "old" }] },
      ours: { nodes: [{ id: "a", label: "new" }] },
      theirs: { nodes: [] },
    });
    expect(opposed.conflicts[0]).toMatchObject({
      path: "/nodes",
      classification: "set-opposed",
    });

    expect(detectConflicts({
      kind: "attackPath",
      key: "route-created-sets",
      base: {},
      ours: { nodes: ["a"] },
      theirs: { nodes: ["b"] },
    })).toEqual({ merged: { nodes: ["a", "b"] }, conflicts: [] });

    const ordered = detectConflicts({
      kind,
      key,
      base: { values: ["a", "b"] },
      ours: { values: ["b", "a"] },
      theirs: { values: ["a", "c"] },
    });
    expect(ordered.conflicts[0]).toMatchObject({ path: "/values", classification: "same-field" });
  });

  it("is order-independent for disjoint object patches", () => {
    for (let index = 0; index < 100; index += 1) {
      const base = { left: index, right: -index, stable: { value: index % 3 } };
      const ours = writePointer(base, "/left", { present: true, value: index + 1 });
      const theirs = writePointer(base, "/right", { present: true, value: index - 1 });
      const merged = detectConflicts({ kind, key, base, ours, theirs });
      const oursThenTheirs = writePointer(ours, "/right", readPointer(theirs, "/right"));
      const theirsThenOurs = writePointer(theirs, "/left", readPointer(ours, "/left"));
      expect(merged.conflicts).toEqual([]);
      expect(merged.merged).toEqual(oursThenTheirs);
      expect(merged.merged).toEqual(theirsThenOurs);
    }
  });
});

describe("conflict attribution", () => {
  it("projects nested pointers and available attribution into the frozen plan conflict shape", async () => {
    registerAttributionProvider("requirement", async () => ({
      actor: "reviewer@example.com",
      at: "2026-08-13T01:00:00.000Z",
      source: "human",
      available: true,
    }));
    const projected = await refinePlanConflicts({
      kind: "requirement",
      key: "requirement-key",
      base: { profile: { title: "base" } },
      ours: { profile: { title: "ours" } },
      theirs: { profile: { title: "theirs" } },
    });
    expect(projected).toEqual([{
      field: "/profile/title",
      base: { present: true, value: "base" },
      ours: { present: true, value: "ours" },
      theirs: { present: true, value: "theirs" },
      attribution: {
        actor: "reviewer@example.com",
        at: "2026-08-13T01:00:00.000Z",
        source: "human",
      },
      suggestion: null,
      resolution: null,
    }]);
  });

  it("caches provider success and suggests VEX theirs only for positive human provenance", async () => {
    let calls = 0;
    registerAttributionProvider("vexDecision", async (_kind, _key, paths) => {
      calls += 1;
      expect(paths).toEqual(["/status"]);
      return {
        actor: "alice@example.com",
        at: "2026-08-13T01:00:00.000Z",
        source: "human",
        available: true,
      };
    });
    const detected = detectConflicts({
      kind: "vexDecision",
      key: "vex-key",
      base: { status: "AFFECTED" },
      ours: { status: "NOT_AFFECTED" },
      theirs: { status: "RESOLVED" },
    }).conflicts;
    const first = await attributeConflicts(detected);
    const second = await attributeConflicts(detected);
    expect(calls).toBe(1);
    expect(first[0]).toMatchObject({
      suggestion: "take-theirs",
      resolution: null,
      attribution: { actor: "alice@example.com", available: true },
    });
    expect(second).toEqual(first);

    registerAttributionProvider("vexDecision", async () => ({
      actor: "triage-service",
      at: "2026-08-13T01:00:01.000Z",
      source: "machine",
      available: true,
    }));
    expect((await attributeConflicts(detected))[0]?.suggestion).toBeNull();
  });

  it("turns provider failure and timeout into usable unavailable conflicts", async () => {
    const detected = detectConflicts({
      kind,
      key,
      base: { title: "base" },
      ours: { title: "ours" },
      theirs: { title: "theirs" },
    }).conflicts;
    registerAttributionProvider(kind, async () => {
      throw new Error("audit unavailable");
    });
    expect((await attributeConflicts(detected))[0]?.attribution).toEqual({
      actor: null,
      at: null,
      source: null,
      available: false,
    });

    registerAttributionProvider(kind, async () => await new Promise(() => undefined));
    expect((await attributeConflicts(detected, 5))[0]?.attribution.available).toBe(false);
  });
});
