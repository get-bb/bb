import { pluginIdSchema } from "@bb/domain";
import { pluginScopeAttribute } from "./portal-scope";

const PLUGIN_NAME_ATTRIBUTE = "data-bb-plugin";

let observer: MutationObserver | null = null;

function scopeAttributeFor(pluginId: string | null): string | null {
  return pluginId !== null && pluginIdSchema.safeParse(pluginId).success
    ? pluginScopeAttribute(pluginId)
    : null;
}

function addScopeAttribute(element: Element): void {
  const attribute = scopeAttributeFor(
    element.getAttribute(PLUGIN_NAME_ATTRIBUTE),
  );
  if (attribute !== null && !element.hasAttribute(attribute)) {
    element.setAttribute(attribute, "");
  }
}

function addScopeAttributesWithin(root: Element): void {
  if (root.hasAttribute(PLUGIN_NAME_ATTRIBUTE)) addScopeAttribute(root);
  for (const element of root.querySelectorAll(`[${PLUGIN_NAME_ATTRIBUTE}]`)) {
    addScopeAttribute(element);
  }
}

function renameScopeAttribute(element: Element, oldPluginId: string | null) {
  const stale = scopeAttributeFor(oldPluginId);
  if (
    stale !== null &&
    stale !== scopeAttributeFor(element.getAttribute(PLUGIN_NAME_ATTRIBUTE))
  ) {
    element.removeAttribute(stale);
  }
  addScopeAttribute(element);
}

export function keepPluginScopeAttributes(): void {
  if (observer !== null) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target instanceof Element) {
          renameScopeAttribute(record.target, record.oldValue);
        }
        continue;
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) addScopeAttributesWithin(node);
      }
    }
  });
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: [PLUGIN_NAME_ATTRIBUTE],
  });
  addScopeAttributesWithin(document.documentElement);
}
