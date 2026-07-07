import {
  PLUGIN_SLOT_ID_PATTERN,
  type PluginAppDefinition,
  type PluginAppSetup,
  type PluginComposerAccessoryRegistration,
  type PluginFileOpenerRegistration,
  type PluginHomepageSectionRegistration,
  type PluginNavPanelRegistration,
  type PluginThreadPanelActionRegistration,
} from "@bb/plugin-sdk";
import type { PluginFrontendRecord } from "./plugin-frontend";
import type { PluginRegistrationSet } from "./plugin-slots";

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

function requireSlotId(kind: string, value: unknown): string {
  if (typeof value !== "string" || !PLUGIN_SLOT_ID_PATTERN.test(value)) {
    throw new Error(
      `${kind}: "id" must match ${String(PLUGIN_SLOT_ID_PATTERN)}, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function requireNonEmptyString(
  kind: string,
  field: string,
  value: unknown,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${kind}: "${field}" must be a non-empty string`);
  }
  return value;
}

function requireComponent<T>(kind: string, value: unknown): T {
  if (typeof value !== "function") {
    throw new Error(`${kind}: "component" must be a React component function`);
  }
  return value as T;
}

function requireUniqueId(kind: string, seen: Set<string>, id: string): void {
  if (seen.has(id)) {
    throw new Error(`${kind}: duplicate id "${id}"`);
  }
  seen.add(id);
}

/**
 * Run a plugin app definition's setup against a fresh collector and return
 * the validated plain registration set. Throws a human-readable error (the
 * plugin's frontend failure message) on invalid registrations.
 */
export function collectPluginAppRegistrations(
  definition: PluginAppDefinition,
): PluginRegistrationSet {
  const homepageSections: PluginHomepageSectionRegistration[] = [];
  const navPanels: PluginNavPanelRegistration[] = [];
  const threadPanelActions: PluginThreadPanelActionRegistration[] = [];
  const composerAccessories: PluginComposerAccessoryRegistration[] = [];
  const fileOpeners: PluginFileOpenerRegistration[] = [];
  const seenIds = {
    homepageSection: new Set<string>(),
    navPanel: new Set<string>(),
    threadPanelAction: new Set<string>(),
    composerAccessory: new Set<string>(),
    fileOpener: new Set<string>(),
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
        const chrome = registration.chrome ?? "page";
        if (chrome !== "page" && chrome !== "none") {
          throw new Error(
            `${kind}: "chrome" must be "page" or "none" when set, got ${JSON.stringify(registration.chrome)}`,
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
        navPanels.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          icon: requireNonEmptyString(kind, "icon", registration.icon),
          path,
          component: requireComponent(kind, registration.component),
          // Default filled here once (the host renders `chrome` as-is).
          chrome,
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
        threadPanelActions.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          ...(registration.icon !== undefined
            ? {
                icon: requireNonEmptyString(kind, "icon", registration.icon),
              }
            : {}),
          component: requireComponent(kind, registration.component),
          ...(registration.run !== undefined ? { run: registration.run } : {}),
        });
      },
      composerAccessory(registration) {
        const kind = "slots.composerAccessory";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.composerAccessory, id);
        composerAccessories.push({
          id,
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
          if (
            typeof extension !== "string" ||
            !/^[a-z0-9]+$/.test(extension)
          ) {
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
    },
  });

  return {
    homepageSections,
    navPanels,
    threadPanelActions,
    composerAccessories,
    fileOpeners,
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
        collectPluginAppRegistrations(definition),
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
