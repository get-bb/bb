import type { PluginSdkApp } from "@bb/plugin-sdk";
import { PluginThreadChat } from "@/components/plugin/PluginThreadChat";
import { definePluginApp } from "./plugin-app-definition";
import {
  useBbContext,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings,
} from "./plugin-sdk-hooks";

/**
 * The real `@bb/plugin-sdk/app` surface (plugin design §5.2), assigned to
 * `globalThis.__bbPluginRuntime.pluginSdkApp` by installPluginRuntime() so
 * `bb plugin build` shims resolve it inside plugin bundles. `satisfies
 * PluginSdkApp` keeps it in type-sync with the facade package; the plugin SDK
 * parity test compares the facade's actual runtime exports with its bundled
 * declarations so declaration-only values cannot leak into the contract.
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
  useComposer,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings,
  // The one host-owned component in the SDK (plugin design: deliberate
  // exception to §5.5) — a stable product capability, not a UI kit.
  ThreadChat: PluginThreadChat,
} satisfies PluginSdkApp;
