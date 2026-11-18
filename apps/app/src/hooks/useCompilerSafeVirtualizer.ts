import {
  elementScroll,
  observeElementOffset,
  observeElementRect,
  Virtualizer,
  type PartialKeys,
  type VirtualItem,
  type VirtualizerOptions,
} from "@tanstack/react-virtual";
import {
  useInsertionEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";

export type CompilerSafeVirtualizerOptions<
  TScrollElement extends Element,
  TItemElement extends Element,
> = Omit<
  PartialKeys<
    VirtualizerOptions<TScrollElement, TItemElement>,
    "observeElementRect" | "observeElementOffset" | "scrollToFn"
  >,
  "onChange"
>;

interface VirtualizerView {
  readonly virtualItems: () => VirtualItem[];
  readonly totalSize: () => number;
}

interface VirtualizerStore<
  TScrollElement extends Element,
  TItemElement extends Element,
> {
  readonly virtualizer: Virtualizer<TScrollElement, TItemElement>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getView: () => VirtualizerView;
  readonly applyOptions: (
    options: CompilerSafeVirtualizerOptions<TScrollElement, TItemElement>,
  ) => void;
  readonly syncAfterCommit: (
    renderedItems: VirtualItem[],
    renderedTotalSize: number,
  ) => void;
  readonly measureElement: (node: TItemElement | null) => void;
}

function resolveVirtualizerOptions<
  TScrollElement extends Element,
  TItemElement extends Element,
>(
  options: CompilerSafeVirtualizerOptions<TScrollElement, TItemElement>,
  onChange: (sync: boolean) => void,
): VirtualizerOptions<TScrollElement, TItemElement> {
  return {
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    ...options,
    onChange: (_instance, sync) => onChange(sync),
  };
}

function createVirtualizerView<
  TScrollElement extends Element,
  TItemElement extends Element,
>(virtualizer: Virtualizer<TScrollElement, TItemElement>): VirtualizerView {
  return {
    virtualItems: () => virtualizer.getVirtualItems(),
    totalSize: () => virtualizer.getTotalSize(),
  };
}

function createVirtualizerStore<
  TScrollElement extends Element,
  TItemElement extends Element,
>(
  initialOptions: CompilerSafeVirtualizerOptions<TScrollElement, TItemElement>,
): VirtualizerStore<TScrollElement, TItemElement> {
  const listeners = new Set<() => void>();
  let measuring = false;
  const emit = () => {
    view = createVirtualizerView(virtualizer);
    for (const listener of listeners) listener();
  };
  const onChange = (sync: boolean) => {
    if (sync && !measuring) {
      flushSync(emit);
    } else {
      emit();
    }
  };
  const virtualizer = new Virtualizer<TScrollElement, TItemElement>(
    resolveVirtualizerOptions(initialOptions, onChange),
  );
  let view = createVirtualizerView(virtualizer);
  const measureVirtualizerElement = virtualizer.measureElement;
  const measureElement = (node: TItemElement | null) => {
    measuring = true;
    try {
      measureVirtualizerElement(node);
    } finally {
      measuring = false;
    }
  };
  virtualizer.measureElement = measureElement;
  return {
    virtualizer,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getView: () => view,
    applyOptions: (options) => {
      virtualizer.setOptions(resolveVirtualizerOptions(options, onChange));
    },
    syncAfterCommit: (renderedItems, renderedTotalSize) => {
      if (
        virtualizer.getVirtualItems() !== renderedItems ||
        virtualizer.getTotalSize() !== renderedTotalSize
      ) {
        emit();
      }
    },
    measureElement,
  };
}

export function useCompilerSafeVirtualizer<
  TScrollElement extends Element,
  TItemElement extends Element,
>(options: CompilerSafeVirtualizerOptions<TScrollElement, TItemElement>) {
  const [store] = useState(() => createVirtualizerStore(options));
  const view = useSyncExternalStore(store.subscribe, store.getView);
  const virtualItems = view.virtualItems();
  const totalSize = view.totalSize();

  useInsertionEffect(() => {
    store.applyOptions(options);
  });
  useLayoutEffect(() => store.virtualizer._didMount(), [store]);
  useLayoutEffect(() => {
    store.virtualizer._willUpdate();
    store.syncAfterCommit(virtualItems, totalSize);
  });

  return {
    virtualItems,
    totalSize,
    measureElement: store.measureElement,
    scrollToIndex: store.virtualizer.scrollToIndex,
    scrollToOffset: store.virtualizer.scrollToOffset,
  };
}
