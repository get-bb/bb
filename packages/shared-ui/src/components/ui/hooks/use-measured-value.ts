import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { observeSharedResize } from "../../../lib/shared-resize-observer";

export type MeasuredTarget<E extends Element> = RefObject<E | null> | E | null;

function resolveTarget<E extends Element>(target: MeasuredTarget<E>): E | null {
  if (target === null) return null;
  return "current" in target ? target.current : target;
}

export function useMeasuredValue<E extends Element, T>(
  target: MeasuredTarget<E>,
  read: (element: E) => T,
  initial: T,
): T {
  const [value, setValue] = useState<T>(initial);
  const elementRef = useRef<E | null>(null);
  useLayoutEffect(() => {
    elementRef.current = resolveTarget(target);
    const element = elementRef.current;
    if (element === null) return;
    setValue(() => read(element));
    return observeSharedResize(element, {
      read: () => read(element),
      write: (next) => setValue(() => next),
    });
  }, [target, read]);
  return value;
}
