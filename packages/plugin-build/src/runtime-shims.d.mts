// Type surface of runtime-shims.mjs (the data lives there so bare-`node`
// generator scripts can read it). Keep the two in step.

export const PLUGIN_SDK_APP_SPECIFIER: "@get-bb/plugin-sdk/app";
export const LEGACY_PLUGIN_SDK_APP_SPECIFIER: "@bb/plugin-sdk/app";
export const SHARED_UI_ICON_SPECIFIER: "@bb/shared-ui/icon";
export const RUNTIME_SLOT_BY_SPECIFIER: Readonly<Record<string, string>>;
export const RUNTIME_SHIM_NPM_SPECIFIERS: readonly string[];
export const SHIMMED_TYPE_PACKAGES: readonly string[];
