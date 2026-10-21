import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useResolvedComposerHint } from "./composer-slot-hooks";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  composerScopeIdentity,
  useOptionalPluginComposerStaticView,
} from "./plugin-composer-host";

const STATUS_CONTENT_SELECTOR =
  "[data-composer-status-banner], [data-composer-status-banner] *";

export function ComposerHintSlot({
  statusStackRef,
}: {
  statusStackRef: RefObject<HTMLDivElement | null>;
}) {
  const view = useOptionalPluginComposerStaticView();
  const registration = useResolvedComposerHint(view?.scope.kind ?? null);
  const [visibleRegistration, setVisibleRegistration] =
    useState<typeof registration>(null);
  const measureStatus = useCallback(() => {
    const stack = statusStackRef.current;
    const hasStatus = stack
      ? Array.from(
          stack.querySelectorAll<HTMLElement>(STATUS_CONTENT_SELECTOR),
        ).some((element) => element.offsetHeight > 0)
      : true;
    setVisibleRegistration(hasStatus ? null : registration);
  }, [registration, statusStackRef]);

  useLayoutEffect(measureStatus);
  useLayoutEffect(() => {
    const stack = statusStackRef.current;
    if (!stack || !registration) return;
    const measure = () => flushSync(measureStatus);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    const observeStatuses = () => {
      resizeObserver?.disconnect();
      resizeObserver?.observe(stack);
      for (const element of stack.querySelectorAll(STATUS_CONTENT_SELECTOR)) {
        resizeObserver?.observe(element);
      }
    };
    observeStatuses();
    const mutationObserver = new MutationObserver(() => {
      observeStatuses();
      measure();
    });
    mutationObserver.observe(stack, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "hidden",
        "data-composer-status-banner",
      ],
    });
    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
    };
  }, [measureStatus, registration, statusStackRef]);

  if (!registration || registration !== visibleRegistration || !view) {
    return null;
  }
  const { hint, key, pluginId, customizationId } = registration;
  const scopeKey = composerScopeIdentity(view.scope);
  return (
    <PluginSlotMount
      key={`${key}/${scopeKey}`}
      pluginId={pluginId}
      slotKind="composerHint"
      slotId={`${customizationId}/${hint.id}`}
      instanceId={scopeKey}
      crashFallback={<></>}
    >
      <div
        data-composer-hint=""
        className="w-full rounded-t-xl bg-muted/50 px-3 py-2 text-sm text-foreground empty:hidden"
      >
        <hint.component />
      </div>
    </PluginSlotMount>
  );
}
