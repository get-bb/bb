import type {
  ComposerCustomization,
  PluginAppDefinition,
  PluginContentScriptRegistration,
  PluginDiffRendererRegistration,
  PluginFileOpenerRegistration,
  PluginHomepageSectionRegistration,
  PluginMessageActionRegistration,
  PluginMessageDirectiveRegistration,
  PluginNavPanelRegistration,
  PluginNewThreadPanelActionRegistration,
  PluginPendingInteractionRegistration,
  PluginProviderIconRegistration,
  PluginSettingsSectionRegistration,
  PluginSidebarFooterActionRegistration,
  PluginSourceCodeRendererRegistration,
  PluginThreadHeaderActionRegistration,
  PluginThreadListRegistration,
  PluginThreadPanelActionRegistration,
} from "@get-bb/plugin-sdk";
import {
  collectComposerCustomization,
  PLUGIN_SLOT_ID_PATTERN,
  requireComponent,
  requireMessageDirectiveId,
  requireNonEmptyString,
  requireOptionalString,
  requireProviderId,
  requireSlotId,
  requireUniqueId,
} from "./composer-customization-validation.js";

type PluginNavPanelFixedTabRegistration = NonNullable<
  PluginNavPanelRegistration["experimental_fixedTabs"]
>[number];

/** Validated registrations produced by one plugin app setup execution. */
export interface CollectedPluginAppRegistrations {
  homepageSections: PluginHomepageSectionRegistration[];
  settingsSections: PluginSettingsSectionRegistration[];
  navPanels: PluginNavPanelRegistration[];
  threadPanelActions: PluginThreadPanelActionRegistration[];
  newThreadPanelActions: PluginNewThreadPanelActionRegistration[];
  composerCustomizations: ComposerCustomization[];
  pendingInteractions: PluginPendingInteractionRegistration[];
  sidebarFooterActions: PluginSidebarFooterActionRegistration[];
  threadLists: PluginThreadListRegistration[];
  threadHeaderActions: PluginThreadHeaderActionRegistration[];
  fileOpeners: PluginFileOpenerRegistration[];
  sourceCodeRenderers: PluginSourceCodeRendererRegistration[];
  diffRenderers: PluginDiffRendererRegistration[];
  messageDirectives: PluginMessageDirectiveRegistration[];
  messageActions: PluginMessageActionRegistration[];
  providerIcons: PluginProviderIconRegistration[];
  contentScripts: PluginContentScriptRegistration[];
}

/**
 * Run a plugin app definition against the canonical validating collector.
 * Both the BB app and the public test harness use this implementation so a
 * registration accepted by one cannot be rejected or normalized differently
 * by the other.
 */
export function collectPluginAppRegistrations(
  definition: PluginAppDefinition,
  onComposerCustomizationRejected: (reason: string) => void = (reason) =>
    console.warn(reason),
): CollectedPluginAppRegistrations {
  const collected: CollectedPluginAppRegistrations = {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    newThreadPanelActions: [],
    composerCustomizations: [],
    pendingInteractions: [],
    sidebarFooterActions: [],
    threadLists: [],
    threadHeaderActions: [],
    fileOpeners: [],
    sourceCodeRenderers: [],
    diffRenderers: [],
    messageDirectives: [],
    messageActions: [],
    providerIcons: [],
    contentScripts: [],
  };
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
    sourceCodeRenderer: new Set<string>(),
    diffRenderer: new Set<string>(),
    messageDirective: new Set<string>(),
    messageAction: new Set<string>(),
    providerIcon: new Set<string>(),
    contentScript: new Set<string>(),
  };

  definition.setup({
    slots: {
      homepageSection(registration) {
        const kind = "slots.homepageSection";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.homepageSection, id);
        collected.homepageSections.push({
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
        collected.settingsSections.push({
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
        const panelId = id;
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
        const experimentalFixedTabs: PluginNavPanelFixedTabRegistration[] =
          (() => {
            if (registration.experimental_fixedTabs === undefined) return [];
            if (!Array.isArray(registration.experimental_fixedTabs)) {
              throw new Error(
                `${kind}: "experimental_fixedTabs" must be an array when set`,
              );
            }
            const seenFixedTabIds = new Set<string>();
            return registration.experimental_fixedTabs.map((value, index) => {
              const fixedTabKind = `${kind}.experimental_fixedTabs[${index}]`;
              const fixedTab = value as Record<string, unknown> | null;
              const id = requireSlotId(fixedTabKind, fixedTab?.id);
              requireUniqueId(fixedTabKind, seenFixedTabIds, id);
              const layout = fixedTab?.layout;
              if (
                layout !== undefined &&
                layout !== "padded" &&
                layout !== "flush"
              ) {
                throw new Error(
                  `${fixedTabKind}: "layout" must be "padded" or "flush" when set`,
                );
              }
              const fixedTabPanelId = requireNonEmptyString(
                fixedTabKind,
                "panelId",
                fixedTab?.panelId,
              );
              if (fixedTabPanelId !== panelId) {
                throw new Error(
                  `${fixedTabKind}: "panelId" must match its containing navPanel id ${JSON.stringify(panelId)}`,
                );
              }
              const experimentalTarget = fixedTab?.experimental_target;
              if (
                experimentalTarget !== undefined &&
                (typeof experimentalTarget !== "object" ||
                  experimentalTarget === null ||
                  typeof Reflect.get(experimentalTarget, "validate") !==
                    "function")
              ) {
                throw new Error(
                  `${fixedTabKind}: "experimental_target.validate" must be a function when set`,
                );
              }
              return {
                id,
                panelId: fixedTabPanelId,
                title: requireNonEmptyString(
                  fixedTabKind,
                  "title",
                  fixedTab?.title,
                ),
                icon: requireNonEmptyString(
                  fixedTabKind,
                  "icon",
                  fixedTab?.icon,
                ),
                component: requireComponent<
                  PluginNavPanelFixedTabRegistration["component"]
                >(fixedTabKind, fixedTab?.component),
                ...(layout === undefined ? {} : { layout }),
                ...(experimentalTarget === undefined
                  ? {}
                  : {
                      experimental_target:
                        experimentalTarget as PluginNavPanelFixedTabRegistration["experimental_target"],
                    }),
              };
            });
          })();
        collected.navPanels.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          icon: requireNonEmptyString(kind, "icon", registration.icon),
          path,
          component: requireComponent(kind, registration.component),
          ...(experimentalFixedTabs.length > 0
            ? { experimental_fixedTabs: experimentalFixedTabs }
            : {}),
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
        collected.threadPanelActions.push({
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
        collected.newThreadPanelActions.push({
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
        collected.pendingInteractions.push({
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
        collected.sidebarFooterActions.push({
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
        collected.threadLists.push({
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
        collected.threadHeaderActions.push({
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
        collected.fileOpeners.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          extensions,
          component: requireComponent(kind, registration.component),
        });
      },
      experimental_sourceCodeRenderer(registration) {
        const kind = "slots.experimental_sourceCodeRenderer";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.sourceCodeRenderer, id);
        const description = requireOptionalString(
          kind,
          "description",
          registration.description,
        );
        collected.sourceCodeRenderers.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          ...(description !== undefined ? { description } : {}),
          component: requireComponent(kind, registration.component),
        });
      },
      experimental_diffRenderer(registration) {
        const kind = "slots.experimental_diffRenderer";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.diffRenderer, id);
        const description = requireOptionalString(
          kind,
          "description",
          registration.description,
        );
        collected.diffRenderers.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          ...(description !== undefined ? { description } : {}),
          component: requireComponent(kind, registration.component),
        });
      },
      messageDirective(registration) {
        const kind = "slots.messageDirective";
        const id = requireMessageDirectiveId(kind, registration?.id);
        requireUniqueId(kind, seenIds.messageDirective, id);
        collected.messageDirectives.push({
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
        collected.messageActions.push({
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
      experimental_providerIcon(registration) {
        const kind = "slots.experimental_providerIcon";
        const providerId = requireProviderId(kind, registration?.providerId);
        requireUniqueId(kind, seenIds.providerIcon, providerId);
        collected.providerIcons.push({
          providerId,
          icon: requireComponent(kind, registration.icon),
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
          collected.composerCustomizations.push(customization);
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
        collected.contentScripts.push({ id, mount: registration.mount });
      },
    },
  });

  return collected;
}
