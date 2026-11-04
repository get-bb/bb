import { describe, expect, it } from "vitest";
import { collectPluginAppRegistrations } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import type { PluginAppDefinition } from "@get-bb/plugin-sdk";
import {
  EAGER_PLUGIN_APP_MEMBERS,
  ON_DEMAND_SURFACE_BY_SLOT,
  findOnDemandPluginAppSurfaces,
} from "./plugin-app-on-demand-surfaces.js";

describe("findOnDemandPluginAppSurfaces", () => {
  it("covers every member of the app object the SDK passes to setup", () => {
    let appKeys: string[] = [];
    let slotKeys: string[] = [];
    const definition: PluginAppDefinition = {
      __bbPluginApp: true,
      setup: (app) => {
        appKeys = Object.keys(app);
        slotKeys = Object.keys(app.slots);
      },
    };
    collectPluginAppRegistrations(definition, () => {});

    expect(appKeys.filter((key) => key !== "slots").sort()).toEqual(
      [...EAGER_PLUGIN_APP_MEMBERS].sort(),
    );
    expect(slotKeys).toEqual(
      expect.arrayContaining(Object.keys(ON_DEMAND_SURFACE_BY_SLOT)),
    );
  });

  it.each([
    {
      name: "a minified settings-only frontend",
      js: 'var a=d(e=>{e.slots.settingsSection({id:"configuration",component:c})});export{a as default};',
      expected: ["settings-section"],
    },
    {
      name: "an unminified frontend split across lines",
      js: 'export default definePluginApp((app) => {\n  app.slots\n    .settingsSection({ id: "a", component: A });\n  app.slots.experimental_environmentProviderInputs({ environmentProviderId: "x", component: B });\n});',
      expected: ["environment-provider-inputs", "settings-section"],
    },
    {
      name: "machine provider inputs next to a settings section",
      js: "d(e=>{e.slots.experimental_machineProviderInputs({}),e.slots.settingsSection({})})",
      expected: ["machine-provider-inputs", "settings-section"],
    },
    {
      name: "prose that mentions other app members",
      js: 'const t="Adds a picker to the composer and its commands";d(e=>{e.slots.settingsSection({})})',
      expected: ["settings-section"],
    },
    {
      name: "a local variable called slots",
      js: "function v(slots){return slots.map(s=>s.id)}d(e=>{e.slots.settingsSection({})})",
      expected: ["settings-section"],
    },
    {
      name: "a settings section plus a nav panel",
      js: "d(e=>{e.slots.settingsSection({}),e.slots.navPanel({})})",
      expected: [],
    },
    {
      name: "a content script",
      js: "d(e=>{e.slots.settingsSection({}),e.contentScripts.register({})})",
      expected: [],
    },
    {
      name: "a composer customization",
      js: "d(e=>{e.slots.settingsSection({}),e.composer.customize({})})",
      expected: [],
    },
    {
      name: "a destructured app member",
      js: "d(({slots:s,commands:c})=>{s.settingsSection({}),c.register({})})",
      expected: [],
    },
    {
      name: "slots kept in a variable",
      js: "d(e=>{const s=e.slots;s.settingsSection({})})",
      expected: [],
    },
    {
      name: "slots read by a computed key",
      js: 'd(e=>{e["slots"].settingsSection({})})',
      expected: [],
    },
    {
      name: "a slot method that is not called directly",
      js: "d(e=>{e.slots.settingsSection.call(e.slots,{})})",
      expected: [],
    },
    {
      name: "a frontend that registers nothing",
      js: "d(()=>{})",
      expected: [],
    },
  ])("classifies $name", ({ js, expected }) => {
    expect(findOnDemandPluginAppSurfaces(js)).toEqual(expected);
  });
});
