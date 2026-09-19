import { describe, expect, it } from "vitest";
import {
  decodeCompletedItemHistory,
  decodeHistory,
  parseHistoryPayload,
} from "../src/completed-item-history.js";

const record = [
  "start",
  1,
  100,
  "item/started",
  "agentMessage",
  [{ item: { text: "" } }, [], ["id", "type"]],
];

describe("completed item history decoding", () => {
  it("decodes nested records with the standalone history contract", () => {
    const history = [1, [record]];
    expect(
      decodeCompletedItemHistory(JSON.stringify([1, 3, 300, history])),
    ).toEqual({
      sequence: 3,
      createdAt: 300,
      records: decodeHistory(JSON.stringify(history)),
    });
  });

  it("rejects non-finite numbers nested inside parsed JSON", () => {
    expect(() => parseHistoryPayload('{"nested":[{"value":1e400}]}')).toThrow(
      "Non-finite",
    );
    const metadata = JSON.stringify([
      1,
      3,
      300,
      [
        1,
        [
          [
            "start",
            1,
            100,
            "item/started",
            "agentMessage",
            [{ nested: [0] }, [], []],
          ],
        ],
      ],
    ]);
    expect(() =>
      decodeCompletedItemHistory(
        metadata.replace('"nested":[0]', '"nested":[1e400]'),
      ),
    ).toThrow("Non-finite");
  });

  it.each([
    [2, [record]],
    [1, []],
    [1, [record, record]],
    [1, [["start", 1, 100, "turn/completed", "agentMessage", [{}, [], []]]]],
    [
      1,
      [
        [
          "start",
          1,
          100,
          "item/started",
          "agentMessage",
          [{}, [], ["resultText"]],
        ],
      ],
    ],
    [1, [["start", 3, 100, "item/started", "agentMessage", [{}, [], []]]]],
  ])("rejects invalid nested history %j", (...history) => {
    expect(() =>
      decodeCompletedItemHistory(JSON.stringify([1, 3, 300, history])),
    ).toThrow();
  });
});
