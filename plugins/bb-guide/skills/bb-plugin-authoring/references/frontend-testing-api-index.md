# Frontend testing API symbol index

Use this index to check `app.tsx` test imports; backend-api-index.md lists
the backend and host-entry test entrypoints.
Read `testing.md` for examples and fidelity limits.

## `@get-bb/plugin-sdk/testing/app`

- `RpcCall`
- `SdkCall`
- `PluginSdkTestFakes`
- `NavigateCall`
- `ExperimentalFixedTabOpenCall`
- `ComposerLog`
- `SidebarActionCall` — deprecated, runtime-only for older plugins' tests of
  `experimental_useSidebarThreadActions`
- `TestThreadActionsResolver` — what `renderSlot` `options.threadActions` returns for
  `experimental_useThreadActions(thread)` and the fake thread menus; receives
  the caller's `requestRename`
- `installTestPluginRuntime`
- `CapturedPluginApp`
- `PluginAppSource`
- `loadPluginApp`
- `ContentScriptTestMountOptions`
- `ContentScriptThreadRowStatusCall`
- `MountedPluginContentScripts`
- `mountPluginContentScripts`
- `PluginRpcTestHandlers`
- `RenderSlotOptions`
- `RenderedSlotBehaviorDrivers`
- `RenderedSlotInspectionState`
- `RenderedSlotLifecycleControls`
- `RenderedSlot`
- `renderSlot`
