import { useRef, type RefObject } from "react";

/**
 * A ref that always holds the latest `value`, updated during render so event
 * handlers, async continuations and child callbacks in the same commit read
 * the current value without being re-created per render.
 *
 * Kept in its own hook on purpose: React Compiler refuses to memoize any
 * function that writes a ref during render, and it also types the assigned
 * value as a ref, so an inlined `ref.current = value` costs the whole calling
 * component its memoization (this was one of the reasons
 * `ThreadDetailPromptArea` compiled to nothing). Only the reads matter to the
 * caller; do them outside render.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  // Deliberate render-time write: this hook exists to keep that write (and the
  // compiler bailout it costs) out of the calling component.
  // eslint-disable-next-line react-hooks/refs
  ref.current = value;
  return ref;
}
