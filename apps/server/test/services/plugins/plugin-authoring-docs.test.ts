import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PLUGIN_SDK_APP_EXPORT_NAMES,
  type BbPluginApi,
  type PluginAppSlots,
  type PluginComposerAccessoryProps,
  type PluginHomepageSectionProps,
  type PluginHttpAuthMode,
  type PluginNavPanelProps,
  type PluginNavPanelRegistration,
  type PluginSettingDescriptor,
  type PluginThreadEventPayloads,
  type PluginThreadPanelTabProps,
} from "@bb/plugin-sdk";

/**
 * Durability test for the bb-plugin-authoring builtin skill: the skill must
 * document the ENTIRE plugin API. Growing BbPluginApi or the frontend SDK
 * surface without documenting the new member fails here.
 */

const SKILL_PATH = fileURLToPath(
  new URL(
    "../../../src/services/skills/builtin-skills/bb-plugin-authoring/SKILL.md",
    import.meta.url,
  ),
);

/**
 * Every property of BbPluginApi, compile-time checked in both directions:
 * `satisfies` rejects entries that are not keys, and the Missing assertion
 * below rejects keys that are not entries.
 */
const BB_PLUGIN_API_KEYS = [
  "pluginId",
  "log",
  "settings",
  "storage",
  "http",
  "rpc",
  "realtime",
  "background",
  "cli",
  "agents",
  "ui",
  "status",
  "sdk",
  "on",
  "onDispose",
] as const satisfies readonly (keyof BbPluginApi)[];

type MissingApiKey = Exclude<
  keyof BbPluginApi,
  (typeof BB_PLUGIN_API_KEYS)[number]
>;
const _assertAllApiKeysListed: MissingApiKey extends never ? true : never =
  true;
void _assertAllApiKeysListed;

/**
 * Mirrors PluginSettingDescriptor["type"]
 * (packages/plugin-sdk/src/backend-contract.ts) — types only, so the union is
 * mirrored here and compile-time checked in both directions like
 * BB_PLUGIN_API_KEYS above.
 */
const SETTING_DESCRIPTOR_TYPES = [
  "string",
  "boolean",
  "select",
  "project",
] as const satisfies readonly PluginSettingDescriptor["type"][];

type MissingSettingType = Exclude<
  PluginSettingDescriptor["type"],
  (typeof SETTING_DESCRIPTOR_TYPES)[number]
>;
const _assertAllSettingTypesListed: MissingSettingType extends never
  ? true
  : never = true;
void _assertAllSettingTypesListed;

/** Mirrors PluginHttpAuthMode (packages/plugin-sdk/src/backend-contract.ts). */
const HTTP_AUTH_MODES = [
  "local",
  "token",
  "none",
] as const satisfies readonly PluginHttpAuthMode[];

type MissingAuthMode = Exclude<
  PluginHttpAuthMode,
  (typeof HTTP_AUTH_MODES)[number]
>;
const _assertAllAuthModesListed: MissingAuthMode extends never ? true : never =
  true;
void _assertAllAuthModesListed;

/**
 * Mirrors PluginThreadEventPayloads
 * (packages/plugin-sdk/src/backend-contract.ts): every event name mapped to
 * every field of its payload. The `satisfies` requires every event key and
 * rejects non-payload fields; the Missing assertions reject omitted fields.
 */
const THREAD_EVENT_PAYLOAD_FIELDS = {
  "thread.created": ["thread"],
  "thread.idle": ["thread", "lastAssistantText"],
  "thread.failed": ["thread", "error"],
} as const satisfies {
  [E in keyof PluginThreadEventPayloads]: readonly (keyof PluginThreadEventPayloads[E])[];
};

type MissingThreadEventField = {
  [E in keyof PluginThreadEventPayloads]: Exclude<
    keyof PluginThreadEventPayloads[E],
    (typeof THREAD_EVENT_PAYLOAD_FIELDS)[E][number]
  >;
}[keyof PluginThreadEventPayloads];
const _assertAllThreadEventFieldsListed: MissingThreadEventField extends never
  ? true
  : never = true;
void _assertAllThreadEventFieldsListed;

/**
 * Mirrors the frontend slot registry (PluginAppSlots and the per-slot props
 * contracts in packages/plugin-sdk/src/app-contract.ts): every slot name
 * mapped to every field of its props. Checked in both directions like the
 * thread events above; MissingSlot rejects a PluginAppSlots method without an
 * entry here.
 */
type SlotPropsByName = {
  homepageSection: PluginHomepageSectionProps;
  navPanel: PluginNavPanelProps;
  threadPanelTab: PluginThreadPanelTabProps;
  composerAccessory: PluginComposerAccessoryProps;
};

type MissingSlot = Exclude<keyof PluginAppSlots, keyof SlotPropsByName>;
const _assertAllSlotsListed: MissingSlot extends never ? true : never = true;
void _assertAllSlotsListed;

const FRONTEND_SLOT_PROP_FIELDS = {
  homepageSection: ["projectId"],
  navPanel: [],
  threadPanelTab: ["threadId"],
  composerAccessory: ["projectId", "threadId"],
} as const satisfies {
  [S in keyof SlotPropsByName]: readonly (keyof SlotPropsByName[S])[];
};

type MissingSlotPropField = {
  [S in keyof SlotPropsByName]: Exclude<
    keyof SlotPropsByName[S],
    (typeof FRONTEND_SLOT_PROP_FIELDS)[S][number]
  >;
}[keyof SlotPropsByName];
const _assertAllSlotPropFieldsListed: MissingSlotPropField extends never
  ? true
  : never = true;
void _assertAllSlotPropFieldsListed;

/**
 * Mirrors PluginNavPanelRegistration (app-contract.ts) — the one slot whose
 * registration carries behavior fields (`chrome`, `headerContent`) beyond
 * id/title/component, so those must stay documented too. Compile-time
 * checked in both directions like the slot props above.
 */
const NAV_PANEL_REGISTRATION_FIELDS = [
  "id",
  "title",
  "icon",
  "path",
  "component",
  "chrome",
  "headerContent",
] as const satisfies readonly (keyof PluginNavPanelRegistration)[];

type MissingNavPanelRegistrationField = Exclude<
  keyof PluginNavPanelRegistration,
  (typeof NAV_PANEL_REGISTRATION_FIELDS)[number]
>;
const _assertAllNavPanelRegistrationFieldsListed: MissingNavPanelRegistrationField extends never
  ? true
  : never = true;
void _assertAllNavPanelRegistrationFieldsListed;

describe("bb-plugin-authoring skill", () => {
  const skill = readFileSync(SKILL_PATH, "utf8");

  it("has frontmatter naming the skill after its directory", () => {
    expect(skill).toMatch(/^---\nname: bb-plugin-authoring\n/);
  });

  it("documents every BbPluginApi property", () => {
    for (const key of BB_PLUGIN_API_KEYS) {
      expect(skill, `bb.${key} is not documented in the skill`).toContain(
        `bb.${key}`,
      );
    }
  });

  it("documents every @bb/plugin-sdk/app runtime export", () => {
    for (const name of PLUGIN_SDK_APP_EXPORT_NAMES) {
      expect(skill, `${name} is not documented in the skill`).toContain(name);
    }
  });

  it("documents every settings descriptor type", () => {
    for (const type of SETTING_DESCRIPTOR_TYPES) {
      expect(
        skill,
        `settings descriptor type "${type}" is not documented in the skill`,
      ).toContain(`type: "${type}"`);
    }
  });

  it("documents every http auth mode", () => {
    for (const mode of HTTP_AUTH_MODES) {
      expect(
        skill,
        `http auth mode "${mode}" is not documented in the skill`,
      ).toContain(`"${mode}"`);
    }
  });

  it("documents every thread event and its payload fields", () => {
    for (const [event, fields] of Object.entries(
      THREAD_EVENT_PAYLOAD_FIELDS,
    )) {
      expect(skill, `${event} is not documented in the skill`).toContain(
        `"${event}"`,
      );
      for (const field of fields) {
        expect(
          skill,
          `${event} payload field "${field}" is not documented in the skill`,
        ).toContain(field);
      }
    }
  });

  it("documents every navPanel registration field (incl. chrome + headerContent)", () => {
    for (const field of NAV_PANEL_REGISTRATION_FIELDS) {
      expect(
        skill,
        `navPanel registration field "${field}" is not documented in the skill`,
      ).toContain(field);
    }
    // Both chrome modes must be spelled out.
    expect(skill).toContain('"page"');
    expect(skill).toContain('"none"');
  });

  it("documents the plugin logo convention (both theme variants)", () => {
    expect(skill).toContain("logo.svg");
    expect(skill).toContain("bb.logo");
    expect(skill).toContain("logo-dark.svg");
    expect(skill).toContain("bb.logoDark");
  });

  it("documents every frontend slot and its prop fields", () => {
    for (const [slot, fields] of Object.entries(FRONTEND_SLOT_PROP_FIELDS)) {
      expect(skill, `slot ${slot} is not documented in the skill`).toContain(
        slot,
      );
      for (const field of fields) {
        expect(
          skill,
          `slot ${slot} prop field "${field}" is not documented in the skill`,
        ).toContain(field);
      }
    }
  });
});
