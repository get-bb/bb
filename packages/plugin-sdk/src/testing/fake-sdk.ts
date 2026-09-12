import { validatePluginMetadata } from "@bb/domain";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

type BbSdk = BbPluginApi["sdk"];

/** One recorded `bb.sdk` call. `path` is dot-joined, e.g. "threads.spawn". */
export interface FakeSdkCall {
  path: string;
  args: unknown[];
}

/**
 * A stub keeps the real method's parameter types but may return anything —
 * tests usually only build the fields the plugin reads, not the full wire
 * response.
 */
type LooseStub<F> = F extends (...args: infer A) => unknown
  ? (...args: A) => unknown
  : never;

/**
 * Stub implementations keyed like `BbSdk`: an object per area with a subset
 * of its methods, or a function for the root-level members (`on`).
 */
type FakeSdkOverrideTree<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? LooseStub<T[K]>
    : FakeSdkOverrideTree<T[K]>;
};

export type FakeSdkOverrides = FakeSdkOverrideTree<BbSdk>;

export interface FakeSdkHarness {
  /**
   * Every `bb.sdk` call in order, including ones whose stub threw. Calls
   * rejected by argument validation are not recorded.
   */
  readonly calls: FakeSdkCall[];
  /** Argument lists of the calls to one dot-joined path. */
  callsTo(path: string): unknown[][];
  /** Add or replace one method's implementation after creation. */
  stub(path: string, implementation: (...args: never[]) => unknown): void;
}

/**
 * Mirrors the server's `wrapSdkForPlugin` attribution for `threads.spawn` and
 * `threads.fork`. A `pluginMetadata` seed is validated like the real SDK does
 * and always attributes the new thread to the plugin, overriding `origin` and
 * `originPluginId`. Without a seed, `origin` defaults to "plugin" and, for that
 * origin, `originPluginId` defaults to the plugin's id. Throws when the seed is
 * invalid.
 */
function withThreadAttribution(pluginId: string, args: unknown[]): unknown[] {
  const [first, ...rest] = args;
  if (typeof first !== "object" || first === null) return args;
  const threadArgs = first as {
    origin?: string;
    originPluginId?: string;
    pluginMetadata?: unknown;
  };
  if (threadArgs.pluginMetadata !== undefined) {
    return [
      {
        ...threadArgs,
        pluginMetadata: validatePluginMetadata(threadArgs.pluginMetadata),
        origin: "plugin",
        originPluginId: pluginId,
      },
      ...rest,
    ];
  }
  const origin = threadArgs.origin ?? "plugin";
  return [
    {
      ...threadArgs,
      origin,
      ...(origin === "plugin"
        ? { originPluginId: threadArgs.originPluginId ?? pluginId }
        : {}),
    },
    ...rest,
  ];
}

/**
 * Mirrors the server's `wrapSdkForPlugin` for `threads.getPluginMetadata` and
 * `threads.updatePluginMetadata`: `pluginId` defaults to the plugin's id. When
 * `validateSet` is true, `set` is validated like the real SDK does. Throws
 * when `set` is invalid.
 */
function withPluginMetadataTarget(
  pluginId: string,
  args: unknown[],
  validateSet: boolean,
): unknown[] {
  const [first, ...rest] = args;
  if (typeof first !== "object" || first === null) return args;
  const input = first as { pluginId?: string; set?: unknown };
  return [
    {
      ...input,
      pluginId: input.pluginId ?? pluginId,
      ...(validateSet && input.set !== undefined
        ? { set: validatePluginMetadata(input.set) }
        : {}),
    },
    ...rest,
  ];
}

function normalizeCallArgs(
  pluginId: string,
  path: string,
  args: unknown[],
): unknown[] {
  switch (path) {
    case "threads.spawn":
    case "threads.fork":
      return withThreadAttribution(pluginId, args);
    case "threads.getPluginMetadata":
      return withPluginMetadataTarget(pluginId, args, false);
    case "threads.updatePluginMetadata":
      return withPluginMetadataTarget(pluginId, args, true);
    default:
      return args;
  }
}

/**
 * Recordable `bb.sdk` stand-in for {@link createFakePluginHost}. Calls are
 * recorded after the plugin-bound normalization the server applies, so
 * assertions see what the server would receive. Arguments the real SDK
 * rejects before sending, such as invalid `pluginMetadata`, return a rejected
 * promise and are not recorded. Calls without a stubbed implementation throw
 * with a message naming the exact path to stub.
 */
export function createFakeSdk(options: {
  pluginId: string;
  overrides?: FakeSdkOverrides;
}): { sdk: BbSdk; harness: FakeSdkHarness } {
  const calls: FakeSdkCall[] = [];
  const stubs = new Map<string, (...args: unknown[]) => unknown>();

  function addOverrides(prefix: string, value: unknown): void {
    if (typeof value === "function") {
      stubs.set(prefix, value as (...args: unknown[]) => unknown);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      addOverrides(prefix.length === 0 ? key : `${prefix}.${key}`, child);
    }
  }
  addOverrides("", options.overrides ?? {});

  function invoke(path: string, rawArgs: unknown[]): unknown {
    let args: unknown[];
    try {
      args = normalizeCallArgs(options.pluginId, path, rawArgs);
    } catch (error) {
      return Promise.reject(error);
    }
    calls.push({ path, args });
    const stub = stubs.get(path);
    if (!stub) {
      throw new Error(
        `bb.sdk.${path} is not stubbed — pass an implementation via ` +
          `createFakePluginHost({ sdk: { ... } }) or harness.sdk.stub("${path}", fn)`,
      );
    }
    return stub(...args);
  }

  const nodes = new Map<string, unknown>();
  /** Callable-and-traversable proxy: `sdk.threads.spawn(...)` and `sdk.subscribe(...)` both work. */
  function node(path: string): unknown {
    const cached = nodes.get(path);
    if (cached) return cached;
    const created = new Proxy(function () {}, {
      get(_target, prop) {
        // Not thenable: an accidentally awaited node must not hang.
        if (typeof prop !== "string" || prop === "then") return undefined;
        return node(path === "" ? prop : `${path}.${prop}`);
      },
      apply(_target, _thisArg, args: unknown[]) {
        return invoke(path, args);
      },
    });
    nodes.set(path, created);
    return created;
  }

  const harness: FakeSdkHarness = {
    calls,
    callsTo(path) {
      return calls
        .filter((call) => call.path === path)
        .map((call) => call.args);
    },
    stub(path, implementation) {
      stubs.set(path, implementation as (...args: unknown[]) => unknown);
    },
  };

  // The proxy is the genuinely unknowable boundary: it answers any BbSdk
  // shape at runtime, and the type is re-imposed here once.
  return { sdk: node("") as BbSdk, harness };
}
