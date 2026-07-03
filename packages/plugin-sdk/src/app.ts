import type { PluginSdkApp } from "./app-contract.js";

export type * from "./app-contract.js";

/**
 * `@bb/plugin-sdk/app` — typed facade over the BB app's plugin runtime.
 *
 * This module's runtime is never bundled into plugins: `bb plugin build`
 * swaps the specifier for a shim reading
 * `globalThis.__bbPluginRuntime.pluginSdkApp` (which the BB app fills with
 * its real implementation before importing any plugin bundle). The re-export
 * below mirrors that shim so code importing this package directly (plugin
 * unit tests, tooling) resolves the same objects when a runtime is
 * installed — and `undefined` values, not a module-load throw, when none is.
 *
 * Hooks-only surface (the host-provided UI kit was removed 2026-07-03,
 * plugin design §5.5): components are vendored shadcn-style source from the
 * BB registry (`npx shadcn add @bb/<name>`); `toast` comes from
 * `import { toast } from "sonner"` (runtime-shimmed to the host toaster).
 */

interface PluginRuntimeHost {
  __bbPluginRuntime?: { pluginSdkApp?: unknown };
}

// The global is the genuinely unknowable boundary here: the host app
// guarantees the shape via its own `satisfies PluginSdkApp` check.
const runtime = ((globalThis as PluginRuntimeHost).__bbPluginRuntime
  ?.pluginSdkApp ?? {}) as Partial<PluginSdkApp> as PluginSdkApp;

export const definePluginApp = runtime.definePluginApp;
export const useRpc = runtime.useRpc;
export const useRealtime = runtime.useRealtime;
export const useSettings = runtime.useSettings;
export const useBbContext = runtime.useBbContext;
export const useBbNavigate = runtime.useBbNavigate;
