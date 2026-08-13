import { describe, expect, it } from "vitest";
import { compileSerialFilter, SerialFilterError } from "./filter.js";
import { createSerialRingBuffer } from "./ring-buffer.js";

describe("serial regex filter", () => {
  it("is per-read and never mutates the underlying lines", () => {
    const buffer = createSerialRingBuffer();
    buffer.append({ at: "2026-08-13T12:00:00.000Z", dir: "rx", text: "boot ok" });
    buffer.append({ at: "2026-08-13T12:00:01.000Z", dir: "rx", text: "sensor error" });
    expect(buffer.read({ maxLines: 10, include: compileSerialFilter("error") }).lines)
      .toHaveLength(1);
    expect(buffer.read({ maxLines: 10, include: compileSerialFilter("boot") }).lines)
      .toHaveLength(1);
    expect(buffer.read({ maxLines: 10 }).lines).toHaveLength(2);
  });

  it("returns a typed recoverable regex-engine error", () => {
    expect(() => compileSerialFilter("["))
      .toThrow(expect.objectContaining({ code: "INVALID_SERIAL_FILTER" } satisfies Partial<SerialFilterError>));
  });

  it("rejects patterns with unbounded backtracking work on the free read path", () => {
    expect(() => compileSerialFilter("(a+)+$"))
      .toThrow(expect.objectContaining({ code: "INVALID_SERIAL_FILTER" }));
    expect(() => compileSerialFilter("(a)\\1"))
      .toThrow(expect.objectContaining({ code: "INVALID_SERIAL_FILTER" }));
    expect(compileSerialFilter("stage=1[0-9]")({
      cursor: 1,
      at: "2026-08-13T12:00:00.000Z",
      dir: "rx",
      text: "stage=12",
    })).toBe(true);
  });
});
