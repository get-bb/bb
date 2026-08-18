// Portable type declarations for `@get-bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/get-bb/bb

import { PluginHomepageSectionRegistration, PluginSettingsSectionRegistration, PluginNavPanelRegistration, PluginThreadPanelActionRegistration, PluginNewThreadPanelActionRegistration, ComposerCustomization, PluginPendingInteractionRegistration, PluginSidebarFooterActionRegistration, PluginThreadListRegistration, PluginThreadHeaderActionRegistration, PluginFileOpenerRegistration, PluginMessageDirectiveRegistration, PluginMessageActionRegistration, PluginProviderIconRegistration, PluginContentScriptRegistration, PluginAppDefinition } from '@get-bb/plugin-sdk';

/** Validated registrations produced by one plugin app setup execution. */
interface CollectedPluginAppRegistrations {
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
declare function collectPluginAppRegistrations(definition: PluginAppDefinition, onComposerCustomizationRejected?: (reason: string) => void): CollectedPluginAppRegistrations;

export { collectPluginAppRegistrations };
export type { CollectedPluginAppRegistrations };
