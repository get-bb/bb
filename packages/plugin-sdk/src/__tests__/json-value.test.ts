import { readFile } from "node:fs/promises";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  JsonValue,
  ExperimentalOpenTabOptions,
  ExperimentalThreadActionTabProps,
} from "../index.js";
import type { JsonValue as AppJsonValue } from "../app.js";

type ActionTabOptions = Extract<
  ExperimentalOpenTabOptions,
  { tab: { availability: "action" } }
>;
type FixedTabOptions = Extract<
  ExperimentalOpenTabOptions,
  { tab: { availability: "fixed" } }
>;

describe("plugin SDK JsonValue contract", () => {
  it("types parameter writes as JsonValue and persisted reads as JsonValue or null", () => {
    expectTypeOf<AppJsonValue>().toEqualTypeOf<JsonValue>();
    expectTypeOf<ActionTabOptions["params"]>().toEqualTypeOf<
      JsonValue | undefined
    >();
    expectTypeOf<FixedTabOptions["target"]>().toEqualTypeOf<
      JsonValue | undefined
    >();
    expectTypeOf<
      ExperimentalThreadActionTabProps["params"]
    >().toEqualTypeOf<JsonValue | null>();

    const recursive: JsonValue = {
      title: "Issue",
      flags: [true, null],
      nested: { count: 2 },
    };
    expectTypeOf(recursive).toMatchTypeOf<JsonValue>();
  });

  it("exports JsonValue from both bundled frontend declaration surfaces", async () => {
    const [rootDeclarations, appDeclarations] = await Promise.all([
      readFile(
        new URL("../../bundled-types/bb-plugin-sdk.d.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../bundled-types/bb-plugin-sdk-app.d.ts", import.meta.url),
        "utf8",
      ),
    ]);

    expect(rootDeclarations).toMatch(/export type \{[^}]*\bJsonValue\b/u);
    expect(appDeclarations).toMatch(/export type \{[^}]*\bJsonValue\b/u);
  });
});
