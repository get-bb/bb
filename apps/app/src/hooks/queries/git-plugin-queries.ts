import { GIT_PLUGIN_ID } from "@bb/domain";
import { gitRpcContract } from "bb-plugin-bb--git/rpc-contract";
import {
  createGitStatusHook,
  type GitStatusKeyedQuery,
} from "bb-plugin-bb--git/status-state";
import { usePluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import { usePluginFrontendRegistered } from "@/lib/plugin-slots";
import {
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
} from "@/lib/plugin-sdk-hooks";

const useGitStatusQuery: GitStatusKeyedQuery = (args) => {
  const frontendsSettled = usePluginFrontendsSettled();
  const gitPluginRegistered = usePluginFrontendRegistered(GIT_PLUGIN_ID);
  const gitPluginOff = frontendsSettled && !gitPluginRegistered;
  return useRpcKeyedQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitRpcContract,
    method: "status",
    keys: gitPluginOff ? [] : args.keys,
    enabled: args.enabled && !gitPluginOff,
  });
};

export const useGitWorkspaceStatus = createGitStatusHook(useGitStatusQuery);
