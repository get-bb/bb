import type { PluginSdkApp } from "./app-contract.js";

export const experimental_THREAD_ACTION_GROUPS = {
  open: "1_open",
  organize: "2_organize",
  settings: "3_settings",
  lifecycle: "4_lifecycle",
} as const satisfies PluginSdkApp["experimental_THREAD_ACTION_GROUPS"];
