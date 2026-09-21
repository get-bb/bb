import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const MOUNT_ROOT_MARGIN = "500px 0px";
const KEEP_ROOT_MARGIN = "1500px 0px";

function initialMountedPages(count: number): ReadonlySet<number> {
  if (typeof IntersectionObserver !== "undefined") return new Set();
  return new Set(Array.from({ length: count }, (_, index) => index));
}

function readPageIndex(
  element: Element,
  slots: Map<number, HTMLElement>,
): number {
  for (const [index, slot] of slots) {
    if (slot === element) return index;
  }
  return -1;
}

export interface TypstPageWindow {
  mounted: ReadonlySet<number>;
  registerSlot: (index: number, element: HTMLElement | null) => void;
}

export function useTypstPageWindow(input: {
  count: number;
  rootRef: RefObject<HTMLElement | null>;
}): TypstPageWindow {
  const { count, rootRef } = input;
  const slotsRef = useRef(new Map<number, HTMLElement>());
  const [mounted, setMounted] = useState<ReadonlySet<number>>(() =>
    initialMountedPages(count),
  );

  useEffect(() => {
    setMounted(initialMountedPages(count));
  }, [count]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const root = rootRef.current;
    if (root === null) return;
    const slots = slotsRef.current;
    const mountObserver = new IntersectionObserver(
      (entries) => {
        const entering: number[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = readPageIndex(entry.target, slots);
          if (index >= 0) entering.push(index);
        }
        if (entering.length === 0) return;
        setMounted((current) => {
          const next = new Set(current);
          for (const index of entering) next.add(index);
          return next;
        });
      },
      { root, rootMargin: MOUNT_ROOT_MARGIN },
    );
    const keepObserver = new IntersectionObserver(
      (entries) => {
        const leaving: number[] = [];
        for (const entry of entries) {
          if (entry.isIntersecting) continue;
          const index = readPageIndex(entry.target, slots);
          if (index >= 0) leaving.push(index);
        }
        if (leaving.length === 0) return;
        setMounted((current) => {
          const next = new Set(current);
          for (const index of leaving) next.delete(index);
          return next;
        });
      },
      { root, rootMargin: KEEP_ROOT_MARGIN },
    );
    for (const element of slots.values()) {
      mountObserver.observe(element);
      keepObserver.observe(element);
    }
    return () => {
      mountObserver.disconnect();
      keepObserver.disconnect();
    };
  }, [count, rootRef]);

  const registerSlot = useCallback(
    (index: number, element: HTMLElement | null): void => {
      if (element === null) slotsRef.current.delete(index);
      else slotsRef.current.set(index, element);
    },
    [],
  );

  return { mounted, registerSlot };
}
