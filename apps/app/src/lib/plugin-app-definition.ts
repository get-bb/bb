import {
  type ComposerCustomization,
  type PluginAppDefinition,
  type PluginAppSetup,
  type PluginContentScriptRegistration,
  type PluginFileOpenerRegistration,
  type PluginHomepageSectionRegistration,
  type PluginMessageActionRegistration,
  type PluginMessageDirectiveRegistration,
  type PluginNavPanelRegistration,
  type PluginNewThreadPanelActionRegistration,
  type PluginPendingInteractionRegistration,
  type PluginSettingsSectionRegistration,
  type PluginSidebarFooterActionRegistration,
  type PluginThreadListRegistration,
  type PluginThreadHeaderActionRegistration,
  type PluginThreadPanelActionRegistration,
} from "@bb/plugin-sdk";
import {
  collectComposerCustomization,
  PLUGIN_SLOT_ID_PATTERN,
  requireComponent,
  requireMessageDirectiveId,
  requireNonEmptyString,
  requireOptionalString,
  requireSlotId,
  requireUniqueId,
} from "@bb/plugin-sdk/internal/composer-customization-validation";
import type { PluginFrontendRecord } from "./plugin-frontend";
import type { PluginRegistrationSet } from "./plugin-slots";

export type CollectedPluginAppRegistrations = PluginRegistrationSet & {
  contentScripts: readonly PluginContentScriptRegistration[];
};

/**
 * `definePluginApp` + the host-side interpreter (plugin design §5.2). A
 * plugin's `app.tsx` default-exports `definePluginApp(setup)`; after its
 * bundle loads, the host runs `setup` against a fresh collector and stores
 * the resulting plain registration set in the slot store. Interpretation is
 * per-plugin contained: a junk default export or a throwing setup marks that
 * plugin's frontend failed without touching other plugins or its backend.
 */

/** Real `@bb/plugin-sdk/app` implementation of `definePluginApp`. */
export function definePluginApp(setup: PluginAppSetup): PluginAppDefinition {
  if (typeof setup !== "function") {
    throw new Error("definePluginApp expects a setup function");
  }
  return Object.freeze({ __bbPluginApp: true as const, setup });
}

export function isPluginAppDefinition(
  value: unknown,
): value is PluginAppDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __bbPluginApp?: unknown }).__bbPluginApp === true &&
    typeof (value as { setup?: unknown }).setup === "function"
  );
}

/**
 * Run a plugin app definition's setup against a fresh collector and return
 * the validated plain registration set. Throws a human-readable error (the
 * plugin's frontend failure message) on invalid registrations.
 */
export function collectPluginAppRegistrations(
  definition: PluginAppDefinition,
  onComposerCustomizationRejected: (reason: string) => void = (reason) =>
    console.warn(reason),
): CollectedPluginAppRegistrations {
  const homepageSections: PluginHomepageSectionRegistration[] = [];
  const settingsSections: PluginSettingsSectionRegistration[] = [];
  const navPanels: PluginNavPanelRegistration[] = [];
  const threadPanelActions: PluginThreadPanelActionRegistration[] = [];
  const newThreadPanelActions: PluginNewThreadPanelActionRegistration[] = [];
  const composerCustomizations: ComposerCustomization[] = [];
  const pendingInteractions: PluginPendingInteractionRegistration[] = [];
  const sidebarFooterActions: PluginSidebarFooterActionRegistration[] = [];
  const threadLists: PluginThreadListRegistration[] = [];
  const threadHeaderActions: PluginThreadHeaderActionRegistration[] = [];
  const fileOpeners: PluginFileOpenerRegistration[] = [];
  const messageDirectives: PluginMessageDirectiveRegistration[] = [];
  const messageActions: PluginMessageActionRegistration[] = [];
  const contentScripts: PluginContentScriptRegistration[] = [];
  const seenIds = {
    homepageSection: new Set<string>(),
    settingsSection: new Set<string>(),
    navPanel: new Set<string>(),
    threadPanelAction: new Set<string>(),
    newThreadPanelAction: new Set<string>(),
    composerCustomization: new Set<string>(),
    pendingInteraction: new Set<string>(),
    sidebarFooterAction: new Set<string>(),
    threadList: new Set<string>(),
    threadHeaderAction: new Set<string>(),
    fileOpener: new Set<string>(),
    messageDirective: new Set<string>(),
    messageAction: new Set<string>(),
    contentScript: new Set<string>(),
  };

  definition.setup({
    slots: {
      homepageSection(registration) {
        const kind = "slots.homepageSection";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.homepageSection, id);
        homepageSections.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          component: requireComponent(kind, registration.component),
        });
      },
      settingsSection(registration) {
        const kind = "slots.settingsSection";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.settingsSection, id);
        const title = requireOptionalString(kind, "title", registration.title);
        const description = requireOptionalString(
          kind,
          "description",
          registration.description,
        );
        settingsSections.push({
          id,
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          component: requireComponent(kind, registration.component),
        });
      },
      navPanel(registration) {
        const kind = "slots.navPanel";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.navPanel, id);
        const path = requireNonEmptyString(kind, "path", registration.path);
        if (!PLUGIN_SLOT_ID_PATTERN.test(path)) {
          throw new Error(
            `${kind}: "path" must match ${String(PLUGIN_SLOT_ID_PATTERN)} (it becomes a URL segment), got ${JSON.stringify(path)}`,
          );
        }
        if (
          registration.headerContent !== undefined &&
          typeof registration.headerContent !== "function"
        ) {
          throw new Error(
            `${kind}: "headerContent" must be a React component function when set`,
          );
        }
        if (
          registration.experimental_sidebarAccessory !== undefined &&
          typeof registration.experimental_sidebarAccessory !== "function"
        ) {
          throw new Error(
            `${kind}: "experimental_sidebarAccessory" must be a React component function when set`,
          );
        }
        navPanels.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          icon: requireNonEmptyString(kind, "icon", registration.icon),
          path,
          component: requireComponent(kind, registration.component),
          ...(registration.experimental_sidebarAccessory !== undefined
            ? {
                experimental_sidebarAccessory:
                  registration.experimental_sidebarAccessory,
              }
            : {}),
          ...(registration.headerContent !== undefined
            ? { headerContent: registration.headerContent }
            : {}),
        });
      },
      threadPanelAction(registration) {
        const kind = "slots.threadPanelAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.threadPanelAction, id);
        if (
          registration.run !== undefined &&
          typeof registration.run !== "function"
        ) {
          throw new Error(`${kind}: "run" must be a function when set`);
        }
        if (
          registration.layout !== undefined &&
          registration.layout !== "padded" &&
          registration.layout !== "flush"
        ) {
          throw new Error(`${kind}: "layout" must be "padded" or "flush"`);
        }
        threadPanelActions.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          ...(registration.icon !== undefined
            ? {
                icon: requireNonEmptyString(kind, "icon", registration.icon),
              }
            : {}),
          component: requireComponent(kind, registration.component),
          ...(registration.layout !== undefined
            ? { layout: registration.layout }
            : {}),
          ...(registration.run !== undefined ? { run: registration.run } : {}),
        });
      },
      experimental_newThreadPanelAction(registration) {
        const kind = "slots.experimental_newThreadPanelAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.newThreadPanelAction, id);
        if (
          registration.run !== undefined &&
          typeof registration.run !== "function"
        ) {
          throw new Error(`${kind}: "run" must be a function when set`);
        }
        if (
          registration.layout !== undefined &&
          registration.layout !== "padded" &&
          registration.layout !== "flush"
        ) {
          throw new Error(`${kind}: "layout" must be "padded" or "flush"`);
        }
        newThreadPanelActions.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          ...(registration.icon !== undefined
            ? {
                icon: requireNonEmptyString(kind, "icon", registration.icon),
              }
            : {}),
          component: requireComponent(kind, registration.component),
          ...(registration.layout !== undefined
            ? { layout: registration.layout }
            : {}),
          ...(registration.run !== undefined ? { run: registration.run } : {}),
        });
      },
      pendingInteraction(registration) {
        const kind = "slots.pendingInteraction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.pendingInteraction, id);
        pendingInteractions.push({
          id,
          component: requireComponent(kind, registration.component),
        });
      },
      sidebarFooterAction(registration) {
        const kind = "slots.sidebarFooterAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.sidebarFooterAction, id);
        if (typeof registration.run !== "function") {
          throw new Error(`${kind}: "run" must be a function`);
        }
        sidebarFooterActions.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          icon: requireNonEmptyString(kind, "icon", registration.icon),
          run: registration.run,
        });
      },
      experimental_threadList(registration) {
        const kind = "slots.experimental_threadList";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.threadList, id);
        const description = requireOptionalString(
          kind,
          "description",
          registration.description,
        );
        threadLists.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          ...(description !== undefined ? { description } : {}),
          component: requireComponent(kind, registration.component),
        });
      },
      experimental_threadHeaderAction(registration) {
        const kind = "slots.experimental_threadHeaderAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.threadHeaderAction, id);
        threadHeaderActions.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          component: requireComponent(kind, registration.component),
        });
      },
      fileOpener(registration) {
        const kind = "slots.fileOpener";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.fileOpener, id);
        const rawExtensions = registration?.extensions;
        if (!Array.isArray(rawExtensions) || rawExtensions.length === 0) {
          throw new Error(
            `${kind}: "extensions" must be a non-empty array of lowercase extensions without the dot`,
          );
        }
        const extensions = rawExtensions.map((extension) => {
          if (typeof extension !== "string" || !/^[a-z0-9]+$/.test(extension)) {
            throw new Error(
              `${kind}: extensions must be lowercase alphanumerics without the dot, got ${JSON.stringify(extension)}`,
            );
          }
          return extension;
        });
        fileOpeners.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          extensions,
          component: requireComponent(kind, registration.component),
        });
      },
      messageDirective(registration) {
        const kind = "slots.messageDirective";
        const id = requireMessageDirectiveId(kind, registration?.id);
        requireUniqueId(kind, seenIds.messageDirective, id);
        messageDirectives.push({
          id,
          component: requireComponent(kind, registration.component),
        });
      },
      messageAction(registration) {
        const kind = "slots.messageAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.messageAction, id);
        if (typeof registration.run !== "function") {
          throw new Error(`${kind}: "run" must be a function`);
        }
        messageActions.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          ...(registration.icon !== undefined
            ? {
                icon: requireNonEmptyString(kind, "icon", registration.icon),
              }
            : {}),
          run: registration.run,
        });
      },
    },
    composer: {
      customize(registration) {
        const customization = collectComposerCustomization(
          registration,
          seenIds.composerCustomization,
          onComposerCustomizationRejected,
        );
        if (customization !== null) {
          composerCustomizations.push(customization);
        }
      },
    },
    contentScripts: {
      register(registration) {
        const kind = "contentScripts.register";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.contentScript, id);
        if (typeof registration.mount !== "function") {
          throw new Error(`${kind}: "mount" must be a function`);
        }
        contentScripts.push({ id, mount: registration.mount });
      },
    },
  });

  return {
    homepageSections,
    settingsSections,
    navPanels,
    threadPanelActions,
    newThreadPanelActions,
    composerCustomizations,
    pendingInteractions,
    sidebarFooterActions,
    threadLists,
    threadHeaderActions,
    fileOpeners,
    messageDirectives,
    messageActions,
    contentScripts,
  };
}

export interface InterpretPluginFrontendsDeps {
  setRegistrations: (
    pluginId: string,
    registrations: PluginRegistrationSet,
  ) => void;
  warn: (message: string) => void;
}

/**
 * Interpret every loaded record's `module.default` into slot registrations.
 * Mutates `records` in place: a plugin whose default export is not a
 * `definePluginApp` product (or whose setup throws) is downgraded to a
 * "failed" record — contained per plugin, backend untouched. Returns the
 * same map for convenience.
 */
export function interpretPluginFrontends(
  records: Map<string, PluginFrontendRecord>,
  deps: InterpretPluginFrontendsDeps,
): Map<string, PluginFrontendRecord> {
  for (const [pluginId, record] of records) {
    if (record.status !== "loaded") continue;
    try {
      const definition = record.module.default;
      if (!isPluginAppDefinition(definition)) {
        throw new Error(
          "the bundle's default export is not definePluginApp(...) from @bb/plugin-sdk/app",
        );
      }
      deps.setRegistrations(
        pluginId,
        collectPluginAppRegistrations(definition, (reason) => {
          deps.warn(
            `[plugin:${pluginId}] composer customization rejected: ${reason}`,
          );
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.warn(
        `[plugin:${pluginId}] frontend registration failed: ${message}`,
      );
      records.set(pluginId, { pluginId, status: "failed", error: message });
    }
  }
  return records;
}
