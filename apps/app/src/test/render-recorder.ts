interface RecorderFiber {
  tag: number;
  type: unknown;
  flags: number;
  alternate: RecorderFiber | null;
  child: RecorderFiber | null;
  sibling: RecorderFiber | null;
  return: RecorderFiber | null;
  memoizedProps: unknown;
}

interface RenderRecord {
  name: string;
  props: unknown;
  ancestors: readonly string[];
}

interface RecorderHook {
  renderers: Map<number, unknown>;
  supportsFiber: true;
  checkDCE(): void;
  inject(renderer: unknown): number;
  onScheduleFiberRoot(): void;
  onCommitFiberRoot(id: number, root: { current: RecorderFiber }): void;
  onCommitFiberUnmount(): void;
  onPostCommitFiberRoot(): void;
  setStrictMode(): void;
}

export interface RenderRecorder {
  propsOf(componentName: string): unknown[];
  renderedOutside(componentName: string): string[];
  reset(): void;
  uninstall(): void;
}

const FUNCTION_COMPONENT = 0;
const FORWARD_REF = 11;
const SIMPLE_MEMO_COMPONENT = 15;
const PERFORMED_WORK = 1;

function componentName(fiber: RecorderFiber): string | null {
  if (
    fiber.tag !== FUNCTION_COMPONENT &&
    fiber.tag !== FORWARD_REF &&
    fiber.tag !== SIMPLE_MEMO_COMPONENT
  ) {
    return null;
  }
  const type = fiber.type;
  if (typeof type === "function") return type.name;
  if (typeof type === "object" && type !== null && "render" in type) {
    const render = type.render;
    return typeof render === "function" ? render.name : null;
  }
  return null;
}

export function installRenderRecorder(): RenderRecorder {
  const globalScope: typeof globalThis & {
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: RecorderHook;
  } = globalThis;
  if (globalScope.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== undefined) {
    throw new Error("A React DevTools hook is already installed.");
  }
  const records: RenderRecord[] = [];
  let nextRendererId = 1;
  const ancestorsOf = (fiber: RecorderFiber): string[] => {
    const names: string[] = [];
    for (let parent = fiber.return; parent !== null; parent = parent.return) {
      const name = componentName(parent);
      if (name !== null) names.push(name);
    }
    return names;
  };
  const record = (fiber: RecorderFiber) => {
    const name = componentName(fiber);
    if (name === null) return;
    const mounted = fiber.alternate === null;
    if (!mounted && (fiber.flags & PERFORMED_WORK) === 0) return;
    records.push({
      name,
      props: fiber.memoizedProps,
      ancestors: ancestorsOf(fiber),
    });
  };
  const hook: RecorderHook = {
    renderers: new Map(),
    supportsFiber: true,
    checkDCE() {},
    inject(renderer) {
      const id = nextRendererId;
      nextRendererId += 1;
      hook.renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      const stack: RecorderFiber[] = [root.current];
      while (stack.length > 0) {
        const fiber = stack.pop();
        if (fiber === undefined) continue;
        record(fiber);
        const previous = fiber.alternate;
        if (previous !== null && fiber.child === previous.child) continue;
        for (let child = fiber.child; child !== null; child = child.sibling) {
          stack.push(child);
        }
      }
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    setStrictMode() {},
  };
  globalScope.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  return {
    propsOf: (name) =>
      records
        .filter((entry) => entry.name === name)
        .map((entry) => entry.props),
    renderedOutside: (name) =>
      records
        .filter(
          (entry) => entry.name !== name && !entry.ancestors.includes(name),
        )
        .map((entry) => entry.name),
    reset: () => {
      records.length = 0;
    },
    uninstall: () => {
      delete globalScope.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    },
  };
}
