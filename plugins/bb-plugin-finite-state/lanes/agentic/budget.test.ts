import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  enforceBudget,
  normalizePageSize,
  SOFT_RESPONSE_BYTES,
} from "../../lib/agentic/budget.js";
import { fail, ok, serializedBytes } from "../../lib/agentic/result.js";

describe("agent response budget", () => {
  it("default page response stays under the soft budget on seed rows", () => {
    const cursor = encodeCursor(50);
    const items = Array.from({ length: normalizePageSize() }, (_, index) => ({
      id: `CVE-${String(index).padStart(4, "0")}`,
      summary: `Finding ${index}`,
    }));
    const result = enforceBudget(ok({ items, total: 312, cursor }, { nextCursor: cursor }));

    expect(normalizePageSize()).toBe(50);
    expect(normalizePageSize(500)).toBe(200);
    expect(decodeCursor(cursor)).toBe(50);
    expect(result.ok && result.meta.bytes).toBeLessThanOrEqual(
      SOFT_RESPONSE_BYTES,
    );
    expect(result.ok && result.meta.bytes).toBe(serializedBytes(result));
  });

  it("oversized optional summaries truncate without losing ids or cursor", () => {
    const cursor = encodeCursor(200);
    const integrityWarnings = ["source digest mismatch", "cache stale"];
    const result = enforceBudget(
      ok(
        {
          items: [
            { id: "finding-1", summary: "x".repeat(6_000) },
            { id: "finding-2", summary: "y".repeat(6_000) },
          ],
          total: 2,
          cursor,
          integrityWarnings,
        },
        { nextCursor: cursor },
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.nextCursor).toBe(cursor);
    expect(result.data.items.map((item) => item.id)).toEqual([
      "finding-1",
      "finding-2",
    ]);
    expect(result.data.total).toBe(2);
    expect(result.data.cursor).toBe(cursor);
    expect(result.data.integrityWarnings).toEqual(integrityWarnings);
    expect(result.data.items.every((item) => !("summary" in item))).toBe(true);
    expect(result.meta.bytes).toBe(serializedBytes(result));
  });

  it("preserves an existing truncated flag under the soft budget", () => {
    const cursor = encodeCursor(1);
    const result = enforceBudget(
      ok(
        { items: [{ id: "finding-1" }], total: 1 },
        {
          truncated: true,
          nextCursor: cursor,
        },
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.nextCursor).toBe(cursor);
    expect(result.meta.bytes).toBeLessThan(SOFT_RESPONSE_BYTES);
    expect(result.meta.bytes).toBe(serializedBytes(result));
  });

  it("hard-required content over budget is returned with telemetry", () => {
    const integrityFacts = Array.from(
      { length: 100 },
      (_, index) => `sha256:${String(index).padStart(8, "0")}:${"a".repeat(64)}`,
    );
    const result = enforceBudget(ok({ id: "manifest-1", total: 100, integrityFacts }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.bytes).toBeGreaterThan(SOFT_RESPONSE_BYTES);
    expect(result.meta.truncated).toBeUndefined();
    expect(result.data.integrityFacts).toEqual(integrityFacts);
    expect(result.meta.bytes).toBe(serializedBytes(result));
  });

  it("never truncates errors or their integrity details", () => {
    const failure = fail(
      "integrity_error",
      "The manifest digest does not match.",
      "Re-run fs_firmware_materialize in manifest mode and compare digests.",
      false,
      { expected: "a".repeat(5_000), actual: "b".repeat(5_000) },
    );

    expect(enforceBudget(failure)).toBe(failure);
  });
});
