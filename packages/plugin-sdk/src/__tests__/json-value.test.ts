import { readFile } from "node:fs/promises";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  BbNavigate,
  JsonValue,
  PluginThreadPanelActionContext,
  PluginThreadPanelProps,
} from "../index.js";
import type { JsonValue as AppJsonValue } from "../app.js";

type OpenPanelOptions = NonNullable<
  Parameters<PluginThreadPanelActionContext["openPanel"]>[0]
>;
type NavigatePanelOptions = Parameters<BbNavigate["openThreadPanel"]>[0];

describe("plugin SDK JsonValue contract", () => {
  it("types parameter writes as JsonValue and persisted reads as JsonValue or null", () => {
    expectTypeOf<AppJsonValue>().toEqualTypeOf<JsonValue>();
    expectTypeOf<OpenPanelOptions["params"]>().toEqualTypeOf<
      JsonValue | undefined
    >();
    expectTypeOf<NavigatePanelOptions["params"]>().toEqualTypeOf<
      JsonValue | undefined
    >();
    expectTypeOf<
      PluginThreadPanelProps["params"]
    >().toEqualTypeOf<JsonValue | null>();

    const recursive: JsonValue = {
      title: "Issue",
      flags: [true, null],
      nested: { count: 2 },
    };
    expect(recursive).toEqual({
      title: "Issue",
      flags: [true, null],
      nested: { count: 2 },
    });
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
