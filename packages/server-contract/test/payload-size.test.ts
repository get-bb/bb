import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  computeTimelineRowDelta,
  type TimelineRow,
} from "../src/thread-timeline.js";

interface PayloadSize {
  gzipBytes: number;
  jsonBytes: number;
}

function payloadSize(value: unknown): PayloadSize {
  const json = JSON.stringify(value);
  return {
    gzipBytes: gzipSync(json).byteLength,
    jsonBytes: Buffer.byteLength(json),
  };
}

function row(index: number, detail = "stable"): TimelineRow {
  return {
    id: `timeline-row-${String(index).padStart(4, "0")}`,
    kind: "system",
    threadId: "thr_payload_measurement_123456789",
    turnId: "turn_payload_measurement_123456789",
    sourceSeqStart: index + 1,
    sourceSeqEnd: index + 1,
    startedAt: 1_750_000_000_000 + index,
    createdAt: 1_750_000_000_000 + index,
    systemKind: "debug",
    title: `Timeline measurement row ${index}`,
    detail,
    status: null,
  };
}

describe("server-to-browser timeline payload sizes", () => {
  it("records full and single-row delta sizes across representative windows", () => {
    const measurements = [1, 20, 100].map((rowCount) => {
      const previous = Array.from({ length: rowCount }, (_, index) =>
        row(index),
      );
      const current = previous.map((item, index) =>
        index === rowCount - 1
          ? row(index, "streamed update ".repeat(20))
          : item,
      );
      const compactDelta = computeTimelineRowDelta(previous, current);
      const legacyDelta = {
        ...compactDelta,
        rowOrder: current.map((item) => item.id),
      };
      return {
        rowCount,
        full: payloadSize(current),
        legacyDelta: payloadSize(legacyDelta),
        compactDelta: payloadSize(compactDelta),
      };
    });

    expect(measurements).toEqual([
      {
        rowCount: 1,
        full: { gzipBytes: 216, jsonBytes: 629 },
        legacyDelta: { gzipBytes: 239, jsonBytes: 677 },
        compactDelta: { gzipBytes: 227, jsonBytes: 644 },
      },
      {
        rowCount: 20,
        full: { gzipBytes: 552, jsonBytes: 6_627 },
        legacyDelta: { gzipBytes: 297, jsonBytes: 1_060 },
        compactDelta: { gzipBytes: 230, jsonBytes: 647 },
      },
      {
        rowCount: 100,
        full: { gzipBytes: 1_868, jsonBytes: 31_989 },
        legacyDelta: { gzipBytes: 471, jsonBytes: 2_662 },
        compactDelta: { gzipBytes: 230, jsonBytes: 649 },
      },
    ]);

    for (const measurement of measurements) {
      expect(measurement.compactDelta.jsonBytes).toBeLessThanOrEqual(
        measurement.legacyDelta.jsonBytes,
      );
      expect(measurement.compactDelta.gzipBytes).toBeLessThanOrEqual(
        measurement.legacyDelta.gzipBytes,
      );
    }
  });
});
