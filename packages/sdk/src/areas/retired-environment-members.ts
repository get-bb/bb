import type { PluginsArea } from "./plugins.js";
import { createRetiredEnvironmentPullRequests } from "./retired-environment-pull-requests.js";
import { createRetiredEnvironmentReads } from "./retired-environment-reads.js";

export function createRetiredEnvironmentMembers(
  callRpc: PluginsArea["callRpc"],
) {
  return {
    ...createRetiredEnvironmentReads(callRpc),
    ...createRetiredEnvironmentPullRequests(callRpc),
  };
}
