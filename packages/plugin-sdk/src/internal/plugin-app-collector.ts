import type {
  ComposerCustomization,
  PluginAppDefinition,
  PluginContentScriptRegistration,
  PluginDiffRendererRegistration,
  PluginFileOpenerRegistration,
  PluginHomepageSectionRegistration,
  PluginCommandPaletteActionRegistration,
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
  PluginTimelineRendererRegistration,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  collectComposerCustomization,
  PLUGIN_SLOT_ID_PATTERN,
  requireComponent,
  requireMessageDirectiveId,
  requireNonEmptyString,
  requireOptionalString,
  requireProviderId,
  requireSlotId,
  requireTimelineRendererKind,
  requireUniqueId,
} from "./composer-customization-validation.js";

type PluginNavPanelFixedTabRegistration = NonNullable<
  PluginNavPanelRegistration["fixedTabs"]
>[number];

/**
 * The keys a navPanel registration may carry, pinned to the contract so a
 * renamed or removed field cannot drift out of this list unnoticed.
 */
const NAV_PANEL_REGISTRATION_KEYS: ReadonlySet<string> = new Set(
  Object.keys({
    id: true,
    title: true,
    icon: true,
    path: true,
    component: true,
    fixedTabs: true,
    experimental_sidebarAccessory: true,
    headerContent: true,
  } satisfies Record<keyof PluginNavPanelRegistration, true>),
);

/** Old navPanel keys and the names that replaced them (SDK 0.4.16). */
const RENAMED_NAV_PANEL_KEYS: ReadonlyMap<string, string> = new Map([
  ["experimental_fixedTabs", "fixedTabs"],
]);

/**
 * A plugin built against an SDK before 0.4.16 still passes
 * `experimental_fixedTabs`. Silently dropping it would leave the panel
 * without its tabs and no error (accepted-but-ignored fields are forbidden),
 * so a renamed key fails with its new name and any other stale
 * `experimental_` key fails as unknown.
 */
function requireRegistrationFunction<T>(
  kind: string,
  field: string,
  value: T,
  message: string,
): T {
  try {
    return requireComponent<T>(kind, value);
  } catch {
    throw new Error(`${kind}: "${field}" ${message}`);
  }
}

function rejectStaleNavPanelKeys(
  kind: string,
  registration: PluginNavPanelRegistration,
): void {
  for (const key of Object.keys(registration)) {
    if (NAV_PANEL_REGISTRATION_KEYS.has(key)) continue;
    const renamedTo = RENAMED_NAV_PANEL_KEYS.get(key);
    if (renamedTo !== undefined) {
      throw new Error(
        `${kind}: "${key}" was renamed to "${renamedTo}" in SDK 0.4.16`,
      );
    }
    if (key.startsWith("experimental_")) {
      throw new Error(`${kind}: unknown field "${key}"`);
    }
  }
}

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
  commandPaletteActions: PluginCommandPaletteActionRegistration[];
  providerIcons: PluginProviderIconRegistration[];
  timelineRenderers: PluginTimelineRendererRegistration[];
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
    commandPaletteActions: [],
    providerIcons: [],
    timelineRenderers: [],
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
    commandPaletteAction: new Set<string>(),
    providerIcon: new Set<string>(),
    timelineRenderer: new Set<string>(),
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
        const section: PluginSettingsSectionRegistration = {
          id,
          component: requireComponent(kind, registration.component),
        };
        if (title !== undefined) section.title = title;
        if (description !== undefined) section.description = description;
        collected.settingsSections.push(section);
      },
      navPanel(registration) {
        const kind = "slots.navPanel";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.navPanel, id);
        rejectStaleNavPanelKeys(kind, registration);
        const panelId = id;
        const path = requireNonEmptyString(kind, "path", registration.path);
        if (!PLUGIN_SLOT_ID_PATTERN.test(path)) {
          throw new Error(
            `${kind}: "path" must match ${String(PLUGIN_SLOT_ID_PATTERN)} (it becomes a URL segment), got ${JSON.stringify(path)}`,
          );
        }
        if (registration.headerContent !== undefined) {
          requireRegistrationFunction(
            kind,
            "headerContent",
            registration.headerContent,
            "must be a React component function when set",
          );
        }
        if (registration.experimental_sidebarAccessory !== undefined) {
          requireRegistrationFunction(
            kind,
            "experimental_sidebarAccessory",
            registration.experimental_sidebarAccessory,
            "must be a React component function when set",
          );
        }
        const fixedTabs: PluginNavPanelFixedTabRegistration[] = (() => {
          if (registration.fixedTabs === undefined) return [];
          if (!Array.isArray(registration.fixedTabs)) {
            throw new Error(`${kind}: "fixedTabs" must be an array when set`);
          }
          const seenFixedTabIds = new Set<string>();
          return registration.fixedTabs.map((value, index) => {
            const fixedTabKind = `${kind}.fixedTabs[${index}]`;
            const fixedTab = value ?? {};
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
            const experimentalTarget = fixedTab.experimental_target;
            if (experimentalTarget !== undefined) {
              const parsedExperimentalTarget = z
                .object({})
                .passthrough()
                .safeParse(experimentalTarget);
              if (!parsedExperimentalTarget.success) {
                throw new Error(
                  `${fixedTabKind}: "experimental_target.validate" must be a function when set`,
                );
              }
              requireRegistrationFunction(
                fixedTabKind,
                "experimental_target.validate",
                experimentalTarget.validate,
                "must be a function when set",
              );
            }
            const fixedTabRegistration = {
              id,
              panelId: fixedTabPanelId,
              title: requireNonEmptyString(
                fixedTabKind,
                "title",
                fixedTab?.title,
              ),
              icon: requireNonEmptyString(fixedTabKind, "icon", fixedTab?.icon),
              component: requireComponent<
                PluginNavPanelFixedTabRegistration["component"]
              >(fixedTabKind, fixedTab?.component),
            };
            if (experimentalTarget !== undefined) {
              if (layout !== undefined) {
                return {
                  ...fixedTabRegistration,
                  layout,
                  experimental_target: experimentalTarget,
                };
              }
              return {
                ...fixedTabRegistration,
                experimental_target: experimentalTarget,
              };
            }
            if (layout !== undefined) {
              return { ...fixedTabRegistration, layout };
            }
            return fixedTabRegistration;
          });
        })();
        const navPanel: PluginNavPanelRegistration = {
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          icon: requireNonEmptyString(kind, "icon", registration.icon),
          path,
          component: requireComponent(kind, registration.component),
        };
        if (fixedTabs.length > 0) navPanel.fixedTabs = fixedTabs;
        if (registration.experimental_sidebarAccessory !== undefined) {
          navPanel.experimental_sidebarAccessory =
            registration.experimental_sidebarAccessory;
        }
        if (registration.headerContent !== undefined) {
          navPanel.headerContent = registration.headerContent;
        }
        collected.navPanels.push(navPanel);
      },
      threadPanelAction(registration) {
        const kind = "slots.threadPanelAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.threadPanelAction, id);
        if (
          registration.layout !== undefined &&
          registration.layout !== "padded" &&
          registration.layout !== "flush"
        ) {
          throw new Error(`${kind}: "layout" must be "padded" or "flush"`);
        }
        const action: PluginThreadPanelActionRegistration = {
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          component: requireComponent(kind, registration.component),
        };
        if (registration.icon !== undefined) {
          action.icon = requireNonEmptyString(kind, "icon", registration.icon);
        }
        if (registration.layout !== undefined)
          action.layout = registration.layout;
        if (registration.run !== undefined) {
          action.run = requireRegistrationFunction(
            kind,
            "run",
            registration.run,
            "must be a function when set",
          );
        }
        collected.threadPanelActions.push(action);
      },
      experimental_newThreadPanelAction(registration) {
        const kind = "slots.experimental_newThreadPanelAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.newThreadPanelAction, id);
        if (
          registration.layout !== undefined &&
          registration.layout !== "padded" &&
          registration.layout !== "flush"
        ) {
          throw new Error(`${kind}: "layout" must be "padded" or "flush"`);
        }
        const action: PluginNewThreadPanelActionRegistration = {
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          component: requireComponent(kind, registration.component),
        };
        if (registration.icon !== undefined) {
          action.icon = requireNonEmptyString(kind, "icon", registration.icon);
        }
        if (registration.layout !== undefined)
          action.layout = registration.layout;
        if (registration.run !== undefined) {
          action.run = requireRegistrationFunction(
            kind,
            "run",
            registration.run,
            "must be a function when set",
          );
        }
        collected.newThreadPanelActions.push(action);
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
        const run = requireRegistrationFunction(
          kind,
          "run",
          registration.run,
          "must be a function",
        );
        collected.sidebarFooterActions.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          icon: requireNonEmptyString(kind, "icon", registration.icon),
          run,
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
        const threadList: PluginThreadListRegistration = {
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          component: requireComponent(kind, registration.component),
        };
        if (description !== undefined) threadList.description = description;
        collected.threadLists.push(threadList);
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
          const parsedExtension = z.string().safeParse(extension);
          if (
            !parsedExtension.success ||
            !/^[a-z0-9]+$/.test(parsedExtension.data)
          ) {
            throw new Error(
              `${kind}: extensions must be lowercase alphanumerics without the dot, got ${JSON.stringify(extension)}`,
            );
          }
          return parsedExtension.data;
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
        const renderer: PluginSourceCodeRendererRegistration = {
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          component: requireComponent(kind, registration.component),
        };
        if (description !== undefined) renderer.description = description;
        collected.sourceCodeRenderers.push(renderer);
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
        const renderer: PluginDiffRendererRegistration = {
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          component: requireComponent(kind, registration.component),
        };
        if (description !== undefined) renderer.description = description;
        collected.diffRenderers.push(renderer);
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
        const run = requireRegistrationFunction(
          kind,
          "run",
          registration.run,
          "must be a function",
        );
        const action: PluginMessageActionRegistration = {
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          run,
        };
        if (registration.icon !== undefined) {
          action.icon = requireNonEmptyString(kind, "icon", registration.icon);
        }
        collected.messageActions.push(action);
      },
      commandPaletteAction(registration) {
        const kind = "slots.commandPaletteAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.commandPaletteAction, id);
        const run = requireRegistrationFunction(
          kind,
          "run",
          registration.run,
          "must be a function",
        );
        const action: PluginCommandPaletteActionRegistration = {
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          run,
        };
        if (registration.isAvailable !== undefined) {
          action.isAvailable = requireRegistrationFunction(
            kind,
            "isAvailable",
            registration.isAvailable,
            "must be a function",
          );
        }
        collected.commandPaletteActions.push(action);
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
      experimental_timelineRenderer(registration) {
        const kind = "slots.experimental_timelineRenderer";
        const itemKind = requireTimelineRendererKind(kind, registration?.kind);
        requireUniqueId(kind, seenIds.timelineRenderer, itemKind);
        collected.timelineRenderers.push({
          kind: itemKind,
          component: requireComponent(kind, registration.component),
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
        const mount = requireRegistrationFunction(
          kind,
          "mount",
          registration.mount,
          "must be a function",
        );
        collected.contentScripts.push({ id, mount });
      },
    },
  });

  return collected;
}
