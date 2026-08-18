import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as pluginSdkApp from "@get-bb/plugin-sdk/app";
import {
  type BbPluginApi,
  type PluginAppBuilder,
  type PluginAppSlots,
  type PluginContentScriptContext,
  type PluginContentScriptRegistration,
  type PluginFileOpenerProps,
  type PluginHomepageSectionProps,
  type PluginHttpAuthMode,
  type PluginMessageActionContext,
  type PluginMessageActionRegistration,
  type PluginMessageDirectiveProps,
  type PluginNavPanelProps,
  type PluginNavPanelRegistration,
  type PluginNewThreadPanelProps,
  type PluginPendingInteractionProps,
  type PluginProviderIconRegistration,
  type PluginSettingDescriptor,
  type PluginSettingsSectionProps,
  type PluginSidebarFooterActionProps,
  type PluginThreadHeaderActionProps,
  type PluginThreadListProps,
  type PluginSidebarFooterActionRegistration,
  type PluginThreadEventPayloads,
  type PluginThreadPanelProps,
  type ThreadChatMessageAction,
  type ThreadChatProps,
} from "@get-bb/plugin-sdk";

const FRONTEND_RUNTIME_EXPORT_NAMES = Object.keys(pluginSdkApp).sort();

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
  "events",
  "status",
  "server",
  "hosts",
  "sdk",
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
  "thread.active": ["thread"],
  "thread.idle": ["thread", "lastAssistantText"],
  "thread.failed": ["thread", "error"],
  "thread.archived": ["thread"],
  "thread.deleted": ["thread"],
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
  settingsSection: PluginSettingsSectionProps;
  navPanel: PluginNavPanelProps;
  threadPanelAction: PluginThreadPanelProps;
  experimental_newThreadPanelAction: PluginNewThreadPanelProps;
  pendingInteraction: PluginPendingInteractionProps;
  sidebarFooterAction: PluginSidebarFooterActionProps;
  experimental_threadList: PluginThreadListProps;
  experimental_threadHeaderAction: PluginThreadHeaderActionProps;
  fileOpener: PluginFileOpenerProps;
  messageDirective: PluginMessageDirectiveProps;
  messageAction: PluginMessageActionContext;
  // Registration-object slot: the component receives only className, so the
  // registration type is the documented surface.
  experimental_providerIcon: PluginProviderIconRegistration;
};

type MissingSlot = Exclude<keyof PluginAppSlots, keyof SlotPropsByName>;
const _assertAllSlotsListed: MissingSlot extends never ? true : never = true;
void _assertAllSlotsListed;

const APP_BUILDER_FIELDS = [
  "slots",
  "composer",
  "contentScripts",
] as const satisfies readonly (keyof PluginAppBuilder)[];

type MissingAppBuilderField = Exclude<
  keyof PluginAppBuilder,
  (typeof APP_BUILDER_FIELDS)[number]
>;
const _assertAllAppBuilderFieldsListed: MissingAppBuilderField extends never
  ? true
  : never = true;
void _assertAllAppBuilderFieldsListed;

const CONTENT_SCRIPT_CONTEXT_FIELDS = [
  "pluginId",
  "generation",
  "signal",
  "experimental_setThreadRowStatus",
] as const satisfies readonly (keyof PluginContentScriptContext)[];

type MissingContentScriptContextField = Exclude<
  keyof PluginContentScriptContext,
  (typeof CONTENT_SCRIPT_CONTEXT_FIELDS)[number]
>;
const _assertAllContentScriptContextFieldsListed: MissingContentScriptContextField extends never
  ? true
  : never = true;
void _assertAllContentScriptContextFieldsListed;

const CONTENT_SCRIPT_REGISTRATION_FIELDS = [
  "id",
  "mount",
] as const satisfies readonly (keyof PluginContentScriptRegistration)[];

type MissingContentScriptRegistrationField = Exclude<
  keyof PluginContentScriptRegistration,
  (typeof CONTENT_SCRIPT_REGISTRATION_FIELDS)[number]
>;
const _assertAllContentScriptRegistrationFieldsListed: MissingContentScriptRegistrationField extends never
  ? true
  : never = true;
void _assertAllContentScriptRegistrationFieldsListed;

const FRONTEND_SLOT_PROP_FIELDS = {
  homepageSection: ["projectId"],
  settingsSection: [],
  navPanel: ["subPath"],
  threadPanelAction: ["threadId", "params"],
  experimental_newThreadPanelAction: ["projectId", "params"],
  pendingInteraction: ["interaction", "submit", "cancel"],
  sidebarFooterAction: [],
  experimental_threadList: [
    "activeThreadId",
    "activeProjectId",
    "isCompactViewport",
    "onNavigate",
    "searchQuery",
    "experimental_Original",
  ],
  experimental_threadHeaderAction: [
    "threadId",
    "projectId",
    "isCompactViewport",
  ],
  fileOpener: ["path", "source", "experimental_Original"],
  messageDirective: ["attributes", "source", "message", "openWorkspaceFile"],
  messageAction: ["threadId", "message", "selectedText", "openPanel"],
  experimental_providerIcon: ["providerId", "icon"],
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
 * Mirrors PluginNavPanelRegistration (app-contract.ts), including the shared
 * title-bar `headerContent` action surface. Compile-time checked in both
 * directions like the slot props above.
 */
const NAV_PANEL_REGISTRATION_FIELDS = [
  "id",
  "title",
  "icon",
  "path",
  "component",
  "experimental_fixedTabs",
  "experimental_sidebarAccessory",
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

const SIDEBAR_FOOTER_ACTION_REGISTRATION_FIELDS = [
  "id",
  "title",
  "icon",
  "run",
] as const satisfies readonly (keyof PluginSidebarFooterActionRegistration)[];

type MissingSidebarFooterActionRegistrationField = Exclude<
  keyof PluginSidebarFooterActionRegistration,
  (typeof SIDEBAR_FOOTER_ACTION_REGISTRATION_FIELDS)[number]
>;
const _assertAllSidebarFooterActionRegistrationFieldsListed: MissingSidebarFooterActionRegistrationField extends never
  ? true
  : never = true;
void _assertAllSidebarFooterActionRegistrationFieldsListed;

const MESSAGE_ACTION_REGISTRATION_FIELDS = [
  "id",
  "title",
  "icon",
  "run",
] as const satisfies readonly (keyof PluginMessageActionRegistration)[];

type MissingMessageActionRegistrationField = Exclude<
  keyof PluginMessageActionRegistration,
  (typeof MESSAGE_ACTION_REGISTRATION_FIELDS)[number]
>;
const _assertAllMessageActionRegistrationFieldsListed: MissingMessageActionRegistrationField extends never
  ? true
  : never = true;
void _assertAllMessageActionRegistrationFieldsListed;

/**
 * Mirrors ThreadChatProps (app-contract.ts), compile-time checked in both
 * directions like the registration guards above.
 */
const THREAD_CHAT_PROP_FIELDS = [
  "threadId",
  "variant",
  "layout",
  "focusRequest",
  "permissionPolicy",
  "className",
  "leadingContent",
  "messageActions",
] as const satisfies readonly (keyof ThreadChatProps)[];

type MissingThreadChatPropField = Exclude<
  keyof ThreadChatProps,
  (typeof THREAD_CHAT_PROP_FIELDS)[number]
>;
const _assertAllThreadChatPropFieldsListed: MissingThreadChatPropField extends never
  ? true
  : never = true;
void _assertAllThreadChatPropFieldsListed;

/** Mirrors ThreadChatMessageAction (app-contract.ts). */
const THREAD_CHAT_MESSAGE_ACTION_FIELDS = [
  "id",
  "title",
  "icon",
  "roles",
  "run",
] as const satisfies readonly (keyof ThreadChatMessageAction)[];

type MissingThreadChatMessageActionField = Exclude<
  keyof ThreadChatMessageAction,
  (typeof THREAD_CHAT_MESSAGE_ACTION_FIELDS)[number]
>;
const _assertAllThreadChatMessageActionFieldsListed: MissingThreadChatMessageActionField extends never
  ? true
  : never = true;
void _assertAllThreadChatMessageActionFieldsListed;

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

  it("documents every @get-bb/plugin-sdk/app runtime export", () => {
    for (const name of FRONTEND_RUNTIME_EXPORT_NAMES) {
      expect(skill, `${name} is not documented in the skill`).toContain(name);
    }
  });

  it("documents the complete frontend content-script lifecycle contract", () => {
    for (const field of APP_BUILDER_FIELDS) {
      expect(skill, `PluginAppBuilder.${field} is not documented`).toContain(
        field,
      );
    }
    for (const field of CONTENT_SCRIPT_CONTEXT_FIELDS) {
      expect(
        skill,
        `content-script context.${field} is not documented`,
      ).toContain(field);
    }
    for (const field of CONTENT_SCRIPT_REGISTRATION_FIELDS) {
      expect(
        skill,
        `content-script registration.${field} is not documented`,
      ).toContain(field);
    }
    expect(skill).toContain("not a security sandbox");
    expect(skill).toContain("reverse registration order");
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
    for (const [event, fields] of Object.entries(THREAD_EVENT_PAYLOAD_FIELDS)) {
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

  it("documents every navPanel registration field", () => {
    for (const field of NAV_PANEL_REGISTRATION_FIELDS) {
      expect(
        skill,
        `navPanel registration field "${field}" is not documented in the skill`,
      ).toContain(field);
    }
  });

  it("documents every sidebarFooterAction registration field", () => {
    for (const field of SIDEBAR_FOOTER_ACTION_REGISTRATION_FIELDS) {
      expect(
        skill,
        `sidebarFooterAction registration field "${field}" is not documented in the skill`,
      ).toContain(field);
    }
    expect(skill).toContain("openSettings");
  });

  it("documents every messageAction registration field", () => {
    for (const field of MESSAGE_ACTION_REGISTRATION_FIELDS) {
      expect(
        skill,
        `messageAction registration field "${field}" is not documented in the skill`,
      ).toContain(field);
    }
    expect(skill).toContain("sourceSeqEnd");
  });

  it("documents every ThreadChat prop", () => {
    for (const field of THREAD_CHAT_PROP_FIELDS) {
      expect(
        skill,
        `ThreadChat prop "${field}" is not documented in the skill`,
      ).toContain(field);
    }
  });

  it("documents every ThreadChat message-action field", () => {
    expect(skill).toContain("ThreadChatMessageAction");
    for (const field of THREAD_CHAT_MESSAGE_ACTION_FIELDS) {
      expect(
        skill,
        `ThreadChatMessageAction field "${field}" is not documented in the skill`,
      ).toContain(field);
    }
  });

  it("documents the explicit plugin branding contract", () => {
    expect(skill).toContain("bb.name");
    expect(skill).toContain("bb.description");
    expect(skill).toContain("bb.branding");
    expect(skill).toContain("logo.light");
    expect(skill).toContain("logo.dark");
    expect(skill).toContain("no root logo auto-detection");
    expect(skill).toContain("currentColor");
    expect(skill).toContain("branding.icon");
    expect(skill).toContain("./assets/icon.svg");
    expect(skill).toContain("CSS mask");
    expect(skill).toContain("canonical BB icon name");
    expect(skill).toContain("BB reuses this icon on roomy");
    expect(skill).toContain("Logo-only");
    expect(skill).toContain("manifests remain supported");
    expect(skill).toContain("Do not duplicate");
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
