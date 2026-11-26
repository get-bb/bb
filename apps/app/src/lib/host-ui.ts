import { useContext } from "react";
import { PluginContext } from "@/components/plugin/plugin-context";

export const HOST_UI_ATTRIBUTE = "data-bb-host-ui";
export const PLUGIN_CONTENT_ATTRIBUTE = "data-bb-plugin-content";
export const HOST_OWNED_ATTRIBUTE = "data-bb-host-owned";

const PLUGIN_ROOT_ATTRIBUTE = "data-bb-plugin-root";

export type HostUiProps = { [HOST_UI_ATTRIBUTE]?: "" };
export type PluginContentProps = { [PLUGIN_CONTENT_ATTRIBUTE]?: "" };

const HOST_UI_PROPS: HostUiProps = { [HOST_UI_ATTRIBUTE]: "" };
const PLUGIN_CONTENT_PROPS: PluginContentProps = {
  [PLUGIN_CONTENT_ATTRIBUTE]: "",
};
const NO_PROPS = {};

export function useHostUiProps(): HostUiProps {
  return useContext(PluginContext) === null ? NO_PROPS : HOST_UI_PROPS;
}

export function usePluginContentProps(): PluginContentProps {
  return useContext(PluginContext) === null ? NO_PROPS : PLUGIN_CONTENT_PROPS;
}

function insidePluginArea(element: Element): boolean {
  return element.closest(`[${PLUGIN_ROOT_ATTRIBUTE}]`) !== null;
}

function isInsideHostUi(element: Element): boolean {
  for (
    let node: Element | null = element;
    node !== null;
    node = node.parentElement
  ) {
    if (node.hasAttribute(HOST_UI_ATTRIBUTE)) return insidePluginArea(node);
    if (node.hasAttribute(PLUGIN_ROOT_ATTRIBUTE)) return false;
    if (node !== element && node.hasAttribute(PLUGIN_CONTENT_ATTRIBUTE)) {
      return false;
    }
  }
  return false;
}

function markHostUi(element: Element): void {
  if (!element.hasAttribute(HOST_OWNED_ATTRIBUTE)) {
    element.setAttribute(HOST_OWNED_ATTRIBUTE, "");
  }
  if (element.hasAttribute(PLUGIN_CONTENT_ATTRIBUTE)) return;
  for (const child of element.children) {
    if (
      child.hasAttribute(PLUGIN_ROOT_ATTRIBUTE) &&
      !child.hasAttribute(HOST_UI_ATTRIBUTE)
    ) {
      continue;
    }
    markHostUi(child);
  }
}

export function markHostOwnedElements(root: Element): void {
  if (isInsideHostUi(root)) markHostUi(root);
  for (const element of root.querySelectorAll(`[${HOST_UI_ATTRIBUTE}]`)) {
    if (
      !element.hasAttribute(HOST_OWNED_ATTRIBUTE) &&
      insidePluginArea(element)
    ) {
      markHostUi(element);
    }
  }
}
