import type { ComponentType } from "react";
import type {
  ExperimentalPanelController,
  ExperimentalTabReference,
  JsonValue,
  PluginAppSlots,
} from "../app.js";

const fixedNavTab = {
  id: "details",
  context: { kind: "nav-panel", panelId: "tasks" },
  availability: "fixed",
} satisfies ExperimentalTabReference;

const fixedThreadTab = {
  id: "summary",
  context: { kind: "thread" },
  availability: "fixed",
} satisfies ExperimentalTabReference;

const actionTab = {
  id: "chat",
  context: { kind: "thread" },
  availability: "action",
} satisfies ExperimentalTabReference;

declare const panel: ExperimentalPanelController;
declare const Component: ComponentType<{ threadId: string }>;
declare const slots: PluginAppSlots;
if (false) {
  panel.openTab({ tab: fixedNavTab, target: { recordId: "issue-42" } });
  panel.openTab({ tab: fixedThreadTab, target: ["any", "json"] });
  panel.toggleTab({ tab: fixedThreadTab });
  panel.openTab({ tab: actionTab, params: { threadId: "t" }, title: "Chat" });
  panel.toggleTab({ tab: actionTab, params: null });
  panel.close();
  // @ts-expect-error Fixed tabs take a session target, not persisted params.
  panel.openTab({ tab: fixedNavTab, params: { recordId: "issue-42" } });
  // @ts-expect-error Fixed tabs have a registered title.
  panel.openTab({ tab: fixedThreadTab, title: "Summary" });
  // @ts-expect-error Action tabs take persisted params, not a target.
  panel.toggleTab({ tab: actionTab, target: { recordId: "issue-42" } });
  slots.experimental_tab({
    id: "summary",
    title: "Summary",
    icon: "Info",
    context: { kind: "thread" },
    availability: "fixed",
    component: Component,
    experimental_target: {
      validate: (value: JsonValue): value is string =>
        typeof value === "string",
    },
  });
  // @ts-expect-error Only fixed tabs declare a target validator.
  slots.experimental_tab({
    id: "chat",
    title: "Chat",
    icon: "Chat",
    context: { kind: "thread" },
    availability: "action",
    component: Component,
    experimental_target: {
      validate: (value: JsonValue): value is string =>
        typeof value === "string",
    },
  });
}
