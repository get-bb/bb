import { describe, expect, it } from "vitest";
import { createSerialRingBuffer } from "./ring-buffer.js";

const line = (text: string) => ({
  at: "2026-08-13T12:00:00.000Z",
  dir: "rx" as const,
  text,
});

describe("serial ring buffer", () => {
  it("keeps monotonic cursors and reports an accurate gap after full turnover", () => {
    const buffer = createSerialRingBuffer({ maxLines: 3, maxBytes: 100 });
    for (const text of ["one", "two", "three", "four", "five"]) buffer.append(line(text));
    expect(buffer.lineCount).toBe(3);
    expect(buffer.droppedLines).toBe(2);
    expect(buffer.read({ cursor: 0, maxLines: 10 })).toEqual({
      lines: [
        expect.objectContaining({ cursor: 3, text: "three" }),
        expect.objectContaining({ cursor: 4, text: "four" }),
        expect.objectContaining({ cursor: 5, text: "five" }),
      ],
      nextCursor: 5,
      gaps: [{ afterCursor: 0, dropped: 2 }],
    });
    expect(buffer.read({ cursor: 4, maxLines: 10 })).toMatchObject({
      lines: [{ cursor: 5, text: "five" }],
      nextCursor: 5,
      gaps: [],
    });
  });

  it("bounds memory when one burst line is larger than the whole byte budget", () => {
    const buffer = createSerialRingBuffer({ maxLines: 10, maxBytes: 8 });
    buffer.append(line("0123456789"));
    expect(buffer.lineCount).toBe(0);
    expect(buffer.sizeBytes).toBe(0);
    expect(buffer.latestCursor).toBe(1);
    expect(buffer.read({ cursor: 0, maxLines: 10 })).toEqual({
      lines: [],
      nextCursor: 1,
      gaps: [{ afterCursor: 0, dropped: 1 }],
    });
  });
});
