import type { PluginSdkApp } from "@bb/plugin-sdk";
import { definePluginApp } from "./plugin-app-definition";
import {
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
} from "./plugin-sdk-hooks";

/**
 * The real `@bb/plugin-sdk/app` surface (plugin design §5.2), assigned to
 * `globalThis.__bbPluginRuntime.pluginSdkApp` by installPluginRuntime() so
 * `bb plugin build` shims resolve it inside plugin bundles. `satisfies
 * PluginSdkApp` keeps it in type-sync with the facade package, and a unit
 * test asserts its keys equal PLUGIN_SDK_APP_EXPORT_NAMES (the shim's
 * named-export list).
 *
 * Deliberately hooks-only (the 65-component host-provided UI kit was removed
 * 2026-07-03, plugin design §5.5): plugins vendor shadcn-style component
 * source from the BB registry and own it; the shared-singleton packages
 * (portal radix families, sonner, vaul) reach plugins through their own
 * runtime shims in plugin-frontend.ts, so `import { toast } from "sonner"`
 * hits the host toaster without an SDK member.
 */
export const pluginSdkAppImplementation = {
  definePluginApp,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
} satisfies PluginSdkApp;
