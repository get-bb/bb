import type { CollectedPluginAppRegistrations } from "./plugin-app-registration-collector.js";

type FieldOf<Registration> = Registration extends unknown
  ? keyof Registration & string
  : never;

type ListFieldOf<Registration> = Registration extends unknown
  ? {
      [Field in keyof Registration & string]-?: NonNullable<
        Registration[Field]
      > extends readonly (infer Item)[]
        ? `${Field}[].${FieldOf<Item>}`
        : never;
    }[keyof Registration & string]
  : never;

export type PluginAppComponentPath<Registration> =
  | FieldOf<Registration>
  | ListFieldOf<Registration>;

type Kind = keyof CollectedPluginAppRegistrations;

export const PLUGIN_APP_COMPONENT_FIELDS: {
  readonly [K in Kind]: readonly PluginAppComponentPath<
    CollectedPluginAppRegistrations[K][number]
  >[];
} = {
  homepageSections: ["component"],
  settingsSections: ["component"],
  appOverlays: ["component"],
  setupGuideSections: ["component"],
  navPanels: [
    "component",
    "experimental_sidebar",
    "headerContent",
    "experimental_headerTitle",
  ],
  tabs: ["component"],
  threadPanelActions: ["component"],
  newThreadPanelActions: ["component"],
  composerCustomizations: [
    "actions[].component",
    "banners[].component",
    "experimental_popups[].component",
  ],
  pendingInteractions: ["component"],
  sidebarFooterActions: [],
  experimentalSidebarFooterItems: ["component"],
  threadLists: ["component"],
  experimentalSidebarNavigations: ["component", "headerComponent"],
  threadHeaderActions: ["component"],
  threadContextSegments: ["summary", "action", "details"],
  threadInfoRows: ["component"],
  threadRowMetadata: ["component"],
  threadInfoSections: ["component"],
  threadHeaderRows: ["component"],
  threadHeaderTitles: ["component"],
  threadRails: ["component"],
  threadRailOutlines: ["component"],
  threadContextCardRows: ["component"],
  threadContextCardSections: ["component"],
  threadActions: [],
  browserToolbarActions: ["component"],
  fileOpeners: ["component"],
  sourceCodeRenderers: ["component"],
  diffRenderers: ["component"],
  composers: ["component"],
  messageDirectives: ["component"],
  codeFenceRenderers: ["component"],
  messageActions: [],
  messageMetadata: ["component"],
  commandPaletteActions: [],
  providerIcons: ["icon"],
  icons: ["component"],
  timelineRenderers: ["component"],
  environmentProviderInputs: ["component"],
  machineProviderInputs: ["component"],
  contentScripts: [],
};

function valueAt(record: object, field: string): unknown {
  return Object.entries(record).find(([key]) => key === field)?.[1];
}

function componentsAt(registration: object, path: string): unknown[] {
  const [list, field] = path.split("[].");
  if (field === undefined) return [valueAt(registration, path)];
  const items = valueAt(registration, list ?? "");
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: unknown) =>
    typeof item === "object" && item !== null ? [valueAt(item, field)] : [],
  );
}

export function registrationComponents<K extends Kind>(
  kind: K,
  registration: CollectedPluginAppRegistrations[K][number],
): unknown[] {
  return PLUGIN_APP_COMPONENT_FIELDS[kind].flatMap((path) =>
    componentsAt(registration, path),
  );
}

export function registeredComponents(
  registrations: CollectedPluginAppRegistrations,
): unknown[] {
  return (Object.keys(PLUGIN_APP_COMPONENT_FIELDS) as Kind[]).flatMap((kind) =>
    registrations[kind].flatMap((registration: object) =>
      PLUGIN_APP_COMPONENT_FIELDS[kind].flatMap((path) =>
        componentsAt(registration, path),
      ),
    ),
  );
}
