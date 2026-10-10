import { expect, it } from "vitest";
import {
  computedValues,
  defaultValues,
  evaluate,
  parseDocument,
  validValue,
} from "./model.js";
import { bill, savings } from "./examples.js";

it("recalculates compound growth and bill shares from the same document the agent publishes", () => {
  const doc = parseDocument(JSON.stringify(savings));
  expect(computedValues(doc, defaultValues(doc)).total).toBeCloseTo(
    26532.977,
    2,
  );
  expect(computedValues(doc, { ...defaultValues(doc), rate: 0 }).total).toBe(
    10000,
  );
  const dinner = parseDocument(JSON.stringify(bill));
  expect(computedValues(dinner, defaultValues(dinner)).total).toBe(144);
  expect(validValue(dinner.controls[2], 4.5)).toBe(false);
});
it("rejects unknown references, cycles, malformed charts, and deeply nested input at publication", () => {
  expect(() =>
    parseDocument(
      JSON.stringify({
        ...savings,
        calculations: [{ id: "total", value: { ref: "total" } }],
      }),
    ),
  ).toThrow("Unknown numeric reference");
  expect(() =>
    parseDocument(
      JSON.stringify({
        ...savings,
        calculations: [{ id: "principal", value: 2 }],
      }),
    ),
  ).toThrow("Duplicate");
  expect(() =>
    parseDocument(
      JSON.stringify({
        ...savings,
        blocks: [
          {
            type: "chart",
            title: "Bad",
            style: "line",
            labels: ["A", "B"],
            series: [{ label: "X", values: [1, 2, 3] }],
          },
        ],
      }),
    ),
  ).toThrow("each chart label");
  expect(() => parseDocument("[".repeat(40) + "0" + "]".repeat(40))).toThrow(
    "deeply",
  );
});
it("does not execute content and keeps invalid arithmetic out of displayed results", () => {
  expect(() =>
    parseDocument(
      JSON.stringify({
        title: "Unsafe",
        blocks: [{ type: "html", text: "<script>alert(1)</script>" }],
      }),
    ),
  ).toThrow();
  expect(evaluate({ op: "divide", args: [1, 0] }, {})).toBeNull();
  expect(evaluate({ op: "power", args: [10, 1000] }, {})).toBeNull();
  expect(evaluate({ ref: "constructor" }, {})).toBeNull();
});
it("rejects diagrams with invalid bindings or executable paint", () => {
  const make = (element: unknown) =>
    JSON.stringify({
      title: "Diagram",
      blocks: [
        {
          type: "diagram",
          title: "Drawing",
          description: "A sample",
          width: 400,
          height: 200,
          elements: [element],
        },
      ],
    });
  expect(() =>
    parseDocument(make({ kind: "rect", width: { ref: "missing" } })),
  ).toThrow("Unknown numeric reference");
  expect(() =>
    parseDocument(make({ kind: "rect", fill: "url(https://example.com)" })),
  ).toThrow();
  expect(() =>
    parseDocument(
      make({
        kind: "rect",
        label: "Change",
        choose: { control: "missing", value: "x" },
      }),
    ),
  ).toThrow("valid control");
});
