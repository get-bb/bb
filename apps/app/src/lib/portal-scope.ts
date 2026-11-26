import { useContext } from "react";
import { PluginContext } from "@/components/plugin/plugin-context";
import { HOST_UI_ATTRIBUTE } from "./host-ui";

type PluginScopeAttribute = `data-bb-plugin-scope-${string}`;

export type PluginRootProps = {
  "data-bb-plugin-root": "";
  "data-bb-plugin": string;
} & { [attribute in PluginScopeAttribute]: "" };

export function pluginScopeAttribute(pluginId: string): PluginScopeAttribute {
  return `data-bb-plugin-scope-${pluginId}`;
}

export function pluginRootProps(pluginId: string): PluginRootProps {
  const props: PluginRootProps = {
    "data-bb-plugin-root": "",
    "data-bb-plugin": pluginId,
  };
  props[pluginScopeAttribute(pluginId)] = "";
  return props;
}

export function usePortalScopeProps():
  | { "data-bb-portaled-overlay": "" }
  | ({
      "data-bb-portaled-overlay": "";
      [HOST_UI_ATTRIBUTE]: "";
    } & PluginRootProps) {
  const pluginId = useContext(PluginContext);
  return pluginId === null
    ? { "data-bb-portaled-overlay": "" }
    : {
        "data-bb-portaled-overlay": "",
        [HOST_UI_ATTRIBUTE]: "",
        ...pluginRootProps(pluginId),
      };
}
