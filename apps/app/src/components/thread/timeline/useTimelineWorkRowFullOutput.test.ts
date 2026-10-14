import { describe, expect, it } from "vitest";
import type {
  TimelineCommandWorkRow,
  TimelineOutputPreview,
} from "@bb/server-contract";
import { commandRow } from "@/test/fixtures/thread-timeline-rows";
import {
  resolveTimelineWorkRowFullOutput,
  shouldLoadTimelineWorkRowFullOutput,
} from "./useTimelineWorkRowFullOutput";

const FULL_OUTPUT = `FULL-HEAD ${"x".repeat(5_000)} FULL-TAIL`;
const PREVIEW_OUTPUT =
  "FULL-HEAD xxx\n…[4,000 characters omitted from preview]\nxxx FULL-TAIL";

function bigCommandRow({
  availability = "available",
  output = PREVIEW_OUTPUT,
  status = "completed",
}: {
  availability?: TimelineOutputPreview["experimental_fullOutputAvailability"];
  output?: string;
  status?: TimelineCommandWorkRow["status"];
} = {}): TimelineCommandWorkRow {
  return {
    ...commandRow({
      id: "cmd_big",
      command: "pnpm test",
      output,
      sourceSeqStart: 4,
      sourceSeqEnd: 7,
      threadId: "thr_main",
      turnId: "turn_1",
      status,
      exitCode: status === "pending" ? null : 0,
    }),
    outputPreview: {
      experimental_fullOutputAvailability: availability,
      totalChars: FULL_OUTPUT.length,
    },
  };
}

describe("shouldLoadTimelineWorkRowFullOutput", () => {
  it.each([
    { name: "a finished previewed row", row: bigCommandRow(), expected: true },
    {
      name: "a running row",
      row: bigCommandRow({ status: "pending" }),
      expected: false,
    },
    {
      name: "an already-expired retained output",
      row: bigCommandRow({ availability: "retention-expired" }),
      expected: false,
    },
  ])("loads details for $name: $expected", ({ row, expected }) => {
    expect(shouldLoadTimelineWorkRowFullOutput(row)).toBe(expected);
  });
});

describe("resolveTimelineWorkRowFullOutput", () => {
  it("replaces the preview with the loaded full output", () => {
    expect(
      resolveTimelineWorkRowFullOutput({
        row: bigCommandRow(),
        data: [
          commandRow({
            id: "cmd_big",
            command: "pnpm test",
            output: FULL_OUTPUT,
            threadId: "thr_main",
            turnId: "turn_1",
          }),
        ],
        isError: false,
      }),
    ).toEqual({ output: FULL_OUTPUT, state: "loaded" });
  });

  it("keeps the live preview for a running row", () => {
    expect(
      resolveTimelineWorkRowFullOutput({
        row: bigCommandRow({ status: "pending" }),
        data: undefined,
        isError: false,
      }),
    ).toEqual({ output: PREVIEW_OUTPUT, state: "streaming-preview" });
  });

  it("keeps the preview when the full-output load fails", () => {
    expect(
      resolveTimelineWorkRowFullOutput({
        row: bigCommandRow(),
        data: undefined,
        isError: true,
      }),
    ).toEqual({ output: PREVIEW_OUTPUT, state: "error" });
  });

  it.each([
    { availability: "detail-limit", state: "limited-preview" },
    { availability: "retention-expired", state: "expired-preview" },
  ] as const)(
    "shows the detail preview as $state when details report $availability",
    ({ availability, state }) => {
      const detailPreview =
        "FULL-HEAD detail preview\n…[output remains truncated]\nFULL-TAIL";
      expect(
        resolveTimelineWorkRowFullOutput({
          row: bigCommandRow(),
          data: [bigCommandRow({ availability, output: detailPreview })],
          isError: false,
        }),
      ).toEqual({ output: detailPreview, state });
    },
  );

  it("keeps an already-expired retained output as an expired preview", () => {
    expect(
      resolveTimelineWorkRowFullOutput({
        row: bigCommandRow({ availability: "retention-expired" }),
        data: undefined,
        isError: false,
      }),
    ).toEqual({ output: PREVIEW_OUTPUT, state: "expired-preview" });
  });
});
