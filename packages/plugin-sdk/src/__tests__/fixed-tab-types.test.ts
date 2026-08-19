import { describe, expect, it } from "vitest";
import type {
  ExperimentalAppPanel,
  ExperimentalPluginFixedTabReference,
  JsonValue,
} from "../app.js";

type RecordTarget = { kind: "record"; recordId: string };

const untargetedTab = {
  panelId: "tasks",
  id: "navigation",
} satisfies ExperimentalPluginFixedTabReference;

const targetedTab = {
  panelId: "tasks",
  id: "details",
  experimental_target: {
    validate(value: JsonValue): value is RecordTarget {
      return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        value.kind === "record" &&
        typeof value.recordId === "string"
      );
    },
  },
} satisfies ExperimentalPluginFixedTabReference<RecordTarget>;

declare const panel: ExperimentalAppPanel;
if (false) {
  panel.openFixedTab({
    surface: { kind: "current" },
    tab: untargetedTab,
  });
  panel.openFixedTab({
    surface: { kind: "current" },
    tab: targetedTab,
    target: { kind: "record", recordId: "issue-42" },
  });
  panel.openFixedTab({
    surface: { kind: "current" },
    tab: untargetedTab,
    // @ts-expect-error Untargeted tabs reject targets at compile time.
    target: { kind: "record", recordId: "issue-42" },
  });
  panel.openFixedTab({
    surface: { kind: "current" },
    tab: targetedTab,
    // @ts-expect-error The owner-defined target shape is retained by the ref.
    target: { kind: "record", recordId: 42 },
  });
}

describe("fixed-tab public types", () => {
  it("retain stable owner-declared ids at runtime", () => {
    expect([untargetedTab.id, targetedTab.id]).toEqual([
      "navigation",
      "details",
    ]);
  });
});
