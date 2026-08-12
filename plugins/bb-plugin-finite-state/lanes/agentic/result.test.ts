import { describe, expect, it, vi } from "vitest";
import {
  executeSafely,
  fromException,
  KnownToolError,
  ok,
  serializedBytes,
  writeResult,
} from "../../lib/agentic/result.js";

describe("agent tool results", () => {
  it("known domain error preserves recovery hint", () => {
    const logger = { error: vi.fn() };
    const result = fromException(
      new KnownToolError({
        code: "orphaned_key",
        message: "The stable key no longer resolves.",
        hint: "Re-run fs_findings_query with the component and version filters.",
        retryable: false,
        details: { stableKey: "component-key" },
      }),
      logger,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "orphaned_key",
        message: "The stable key no longer resolves.",
        hint: "Re-run fs_findings_query with the component and version filters.",
        retryable: false,
        details: { stableKey: "component-key" },
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("unknown exception is logged and becomes sanitized internal_error", async () => {
    const logger = { error: vi.fn() };
    const result = await executeSafely(
      () => {
        throw new Error("database password=do-not-return\nsecret stack");
      },
      logger,
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("password=do-not-return"),
    );
    expect(JSON.stringify(result)).not.toContain("do-not-return");
    expect(result).toEqual({
      ok: false,
      error: {
        code: "internal_error",
        message: "The tool could not complete because of an internal error.",
        hint: "Retry once. If the error repeats, inspect `bb plugin logs finite-state` and report the tool name and time.",
        retryable: true,
      },
    });
  });

  it("write success includes a relative path and bounded field diff", () => {
    const diffs = Array.from({ length: 25 }, (_, index) => ({
      field: `field-${index}`,
      from: "a".repeat(200),
      to: "b".repeat(200),
    }));
    const data = writeResult(".fs/triage/product/component.yaml", "update", diffs);
    const result = ok(data);

    expect(data.path).toBe(".fs/triage/product/component.yaml");
    expect(data.op).toBe("update");
    expect(data.diffSummary).toHaveLength(20);
    expect(data.omittedDiffs).toBe(5);
    expect(Buffer.byteLength(data.diffSummary[0]!.from!, "utf8")).toBeLessThanOrEqual(160);
    expect(result.ok && result.meta.bytes).toBe(serializedBytes(result));
    expect(() => writeResult("/tmp/result.yaml", "create", [])).toThrow(
      /worktree-relative/u,
    );
  });
});
