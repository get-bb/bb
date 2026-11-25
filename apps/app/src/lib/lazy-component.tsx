import type { ComponentProps, ComponentType } from "react";
import type { ExperimentalLazyComponent } from "@get-bb/plugin-sdk";
import { defineSplit } from "./define-split";
import { registerLazyPart } from "./lazy-parts";

let sequence = 0;

function NotYetLoaded() {
  return null;
}

function FailedToLoad(): never {
  throw new Error("lazy component failed to load");
}

export function lazyComponent<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): ExperimentalLazyComponent<ComponentProps<T>> {
  type P = ComponentProps<T> & object;
  sequence += 1;
  const Split = defineSplit<P>({
    id: `lazy-component-${sequence}`,
    load: () =>
      load().then((module): ComponentType<P> => module.default),
    loading: NotYetLoaded,
    error: FailedToLoad,
    tier: "preload",
  });
  registerLazyPart(Split, { load: Split.preload, isLoaded: Split.isLoaded });
  return Split;
}
