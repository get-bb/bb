# Frontend API symbol index

Use this index to check public imports from `@get-bb/plugin-sdk/app`.
Read the other frontend references for behavior, fields, and examples.
Read the installed SDK declarations for the exact current signatures.

## Runtime values

- `experimental_Icon`
- `experimental_ProviderIcon`

- `definePluginApp`
- `ThreadChat`
- `Markdown`
- `experimental_FileLink`
- `UrlLink`
- `experimental_NewThreadComposer`
- `experimental_ProviderModelPicker`
- `experimental_PermissionModePicker`
- `experimental_BranchPicker` — the host's branch picker with its options
  loading, for an environment provider's inputs control
- `experimental_useBranches` — searchable local and remote branch lists with
  host-backed refresh for a project source
- `experimental_useCheckoutState` — checkout facts for composing a plugin's
  own checkout branch control with `experimental_useBranches`
- `experimental_SourceCode`
- `experimental_Diff`
- `useRpc`
- `useRealtime`
- `useRealtimeConnectionState`
- `useSettings`
- `useBbContext`
- `useBbNavigate`
- `experimental_useAppPanel`
- `experimental_useFixedTabTarget`
- `useComposer`
- `useComposerView`
- `experimental_useSidebarThreads`
- `experimental_useSidebarThreadActions`
- `experimental_useSidebarThreadPullRequest`
- `experimental_useSidebarThreadSplit`
- `experimental_useSidebarNavigation` — the sidebar navigation items in the
  user's saved order, the active item, and host actions to activate, hide,
  reorder, and customize them
- `experimental_useSidebarNavigationSplit` — drag-to-split support for one
  navigation item
- `experimental_SidebarNavigationIcon` — bb's artwork for a navigation item's
  icon, including plugin branding
- `useSidebarThreadDraft` — whether the composer holds an unsent draft for
  one thread, for the pencil glyph bb's row paints
- `useSidebarThreadDraftIds` — every thread id with an unsent draft, for
  collapsed-group rollups
- `useSidebarThreadRowStatus` — the row status another plugin's app-wide
  script set on a thread, or null
- `useSidebarThreadRowStatuses` — every row status by thread id, for
  collapsed-group rollups
- `useSidebarSplitLayout` — the whole split layout with the thread each pane
  shows, or null when nothing is split
- `useSidebarThreadShortcut` — the jump shortcut assigned to a row while the
  app command modifier is held, or null
- `ThreadTitle` — a thread's display title with its `@project:`, `@section:`,
  and `@thread:` mentions rendered as bb's chips
- `useEnvironmentProviders` — bb's environment provider catalog, for naming
  and drawing the environment a thread runs in
- `useSdk` — bb's public API client bound to this plugin, the same areas the
  `bb` CLI and the backend `bb.sdk` expose
- `experimental_useProviders`
- `experimental_useCodeTheme`

## Type exports

- `ExperimentalAppIcons`
- `ExperimentalIconRegistration`
- `ExperimentalIconProps`
- `ExperimentalProviderIconProps`

- `PluginHomepageSectionProps`
- `PluginSettingsSectionProps`
- `ExperimentalAppOverlayProps`
- `PluginNavPanelProps`
- `PluginThreadPanelProps`
- `PluginNewThreadPanelProps`
- `PluginPendingInteractionView`
- `PluginPendingInteractionProps`
- `BranchPickerProps`
- `UseBranchesArgs`
- `BranchesState`
- `UseCheckoutStateArgs`
- `CheckoutState`
- `PluginEnvironmentProviderInputsChange`
- `PluginEnvironmentProviderInputsProps`
- `PluginEnvironmentProviderInputsRegistration` — the registration accepted by
  `app.slots.experimental_environmentProviderInputs`
- `PluginMachineProviderInputsChange`
- `PluginMachineProviderInputsProps`
- `PluginMachineProviderInputsRegistration` — the registration accepted by
  `app.slots.experimental_machineProviderInputs`
- `PluginSidebarFooterActionProps`
- `ExperimentalSidebarFooterDisclosureProps`
- `ExperimentalSidebarNavigationShortcut`
- `ExperimentalSidebarNavigationAction`
- `ExperimentalSidebarNavigationIcon`
- `ExperimentalSidebarNavigationItem`
- `ExperimentalSidebarNavigationActivationOptions`
- `ExperimentalSidebarNavigationActions`
- `ExperimentalSidebarNavigationState`
- `ExperimentalSidebarNavigationSplit`
- `ExperimentalSidebarNavigationSplitOptions`
- `ExperimentalSidebarNavigationIconProps`
- `ExperimentalSidebarNavigationProps`
- `ExperimentalSidebarHeaderProps`
- `PluginThreadListProps`
- `PluginThreadHeaderActionProps`
- `ExperimentalPluginBrowserToolbarActionProps`
- `ExperimentalPluginBrowserPage`
- `ExperimentalPluginBrowserPageEvaluateOptions`
- `ExperimentalPluginBrowserPageWorld`
- `PluginFileOpenerSource`
- `PluginFileOpenerProps`
- `CodeOverflowMode`
- `DiffViewMode`
- `SourceCodeLineRange`
- `ExperimentalDiffFileContent`
- `ExperimentalDiffFullFileContents`
- `SourceCodeProps`
- `DiffProps`
- `PluginSourceCodeRendererProps`
- `PluginDiffRendererProps`
- `PluginMessageDirectiveMessage`
- `PluginMessageDirectiveOpenWorkspaceFile`
- `PluginMessageDirectiveProps`
- `PluginHomepageSectionRegistration`
- `PluginSettingsSectionRegistration`
- `ExperimentalAppOverlayRegistration`
- `ExperimentalFixedTabTargetContract`
- `ExperimentalPluginFixedTabReference`
- `PluginFixedTabRegistration`
- `PluginFixedTabDeclaration`
- `PluginNavPanelRegistration`
- `PluginPanelActionOpenOptions`
- `PluginThreadPanelActionContext`
- `PluginThreadPanelActionRegistration`
- `PluginNewThreadPanelActionContext`
- `PluginNewThreadPanelActionRegistration`
- `PluginPendingInteractionRegistration`
- `PluginSidebarFooterActionContext`
- `PluginSidebarFooterActionRegistration`
- `ExperimentalSidebarFooterActionContext`
- `ExperimentalSidebarFooterItemBase`
- `ExperimentalSidebarFooterActionRegistration`
- `ExperimentalSidebarFooterDisclosureRegistration`
- `ExperimentalSidebarFooterItemRegistration`
- `ExperimentalSidebarFooterDisclosureController`
- `ExperimentalSidebarFooter`
- `ExperimentalSidebarNavigationRegistration`
- `ExperimentalSidebarHeaderRegistration`
- `PluginSidebarThreadIndicator`
- `PluginSidebarThreadActivity`
- `PluginSidebarThread`
- `PluginSidebarPullRequest`
- `PluginSidebarThreadPullRequestState`
- `PluginSidebarProject`
- `PluginSidebarSection`
- `PluginSidebarThreadsState`
- `PluginProvidersState`
- `PluginCodeThemeTokenRule`
- `PluginCodeThemeData`
- `PluginCodeThemeState`
- `PluginSidebarThreadActions`
- `PluginSidebarThreadDraftState`
- `PluginSidebarThreadRowStatus`
- `PluginSidebarThreadShortcut`
- `PluginThreadTitleProps`
- `PluginEnvironmentProvider`
- `PluginEnvironmentProvidersState`
- `PluginBoundThreadsArea`
- `PluginBrowserBbSdk`
- `PluginThreadHeaderActionRegistration`
- `ExperimentalPluginBrowserToolbarActionRegistration`
- `PluginSidebarSplitPane`
- `PluginSidebarSplitLayout`
- `PluginSidebarThreadSplit`
- `PluginThreadListRegistration`
- `PluginFileOpenerRegistration`
- `PluginSourceCodeRendererRegistration`
- `PluginDiffRendererRegistration`
- `PluginMessageDirectiveRegistration`
- `ThreadChatMessageReference`
- `PluginTargetedPanelActionOpenOptions`
- `PluginMessageActionContext`
- `PluginMessageActionRegistration`
- `PluginAppCommands`
- `PluginCommandContext`
- `PluginCommandShortcut`
- `PluginCommandRegistration`
- `PluginProviderIconRegistration`
- `PluginTimelineRowPresentation`
- `PluginTimelineRowStatus`
- `PluginTimelineRendererRow`
- `PluginTimelineRendererProps`
- `PluginTimelineRendererRegistration`
- `PluginAppSlots`
- `PluginAppComposer`
- `PluginContentScriptContext`
- `PluginContentScriptDisposer`
- `PluginContentScriptRegistration`
- `PluginAppContentScripts`
- `PluginAppBuilder`
- `PluginAppSetup`
- `PluginAppDefinition`
- `PluginRpcClient`
- `PluginSettingsState`
- `PluginRealtimeConnectionState`
- `PluginComposerScope`
- `ComposerCustomization`
- `ComposerPlusMenuItem`
- `ComposerView`
- `ExperimentalComposerSubmitOptions`
- `ExperimentalComposerSelection`
- `ComposerRichTextSpec`
- `ComposerStructuredDraft`
- `PluginComposerTextEffect`
- `PluginComposerThreadRowStatus`
- `PluginComposerMention`
- `PluginComposerApi`
- `ThreadChatMessageAction`
- `ThreadChatProps`
- `ExperimentalProviderModelPickerValue`
- `ExperimentalProviderModelPickerRouting`
- `ExperimentalProviderModelPickerProps`
- `ExperimentalPermissionModePickerProps`
- `NewThreadRequest`
- `NewThreadComposerProps`
- `MarkdownProps`
- `UrlLinkProps`
- `ExperimentalLiveFileTarget`
- `ExperimentalFileLocation`
- `ExperimentalFileOpenOptions`
- `ExperimentalFileLinkProps`
- `ExperimentalAppPanelSurface`
- `ExperimentalFixedTabTargetState`
- `ExperimentalOpenFixedTabOptions`
- `ExperimentalAppPanel`
- `BbContext`
- `BbNavigate`
- `PluginSdkApp`
- `JsonValue`
- `ReadonlyJsonValue`
- `PluginRpcCallArgs`
- `PluginRpcContract`
- `PluginRpcError`
- `PluginRpcErrorCode`
- `PluginRpcHandlers`
- `PluginRpcIssuePathSegment`
- `PluginRpcMethodContract`
- `PluginRpcResult`
- `PluginRpcValidationIssue`
- `StandardSchemaV1`
- `StandardSchemaV1InferInput`
- `StandardSchemaV1InferOutput`
- `StandardSchemaV1Issue`
- `StandardSchemaV1Result`
