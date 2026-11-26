import type { PluginSdkApp } from "./app-contract.js";

export const experimental_THREAD_CONTEXT_SEGMENT_GROUPS = {
  thread: "1_thread",
  git: "3_git",
} as const satisfies PluginSdkApp["experimental_THREAD_CONTEXT_SEGMENT_GROUPS"];

export const experimental_THREAD_INFO_ROW_GROUPS = {
  thread: "1_thread",
  environment: "2_environment",
  pullRequest: "2_pullRequest",
  git: "3_git",
  lifecycle: "5_lifecycle",
} as const satisfies PluginSdkApp["experimental_THREAD_INFO_ROW_GROUPS"];

export const experimental_THREAD_INFO_SECTION_GROUPS = {
  related: "1_related",
  changes: "2_changes",
  storage: "3_storage",
} as const satisfies PluginSdkApp["experimental_THREAD_INFO_SECTION_GROUPS"];
