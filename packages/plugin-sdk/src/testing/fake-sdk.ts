import type { BbSdk } from "@bb/sdk";

/**
 * Recordable `bb.sdk` stand-in for {@link createFakePluginHost}. Every call
 * through the fake is recorded (post plugin-attribution defaulting, so
 * assertions see what the server would receive); calls without a stubbed
 * implementation throw with a message naming the exact path to stub.
 */

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
export type FakeSdkOverrides = {
  [K in keyof BbSdk]?: BbSdk[K] extends (...args: never[]) => unknown
    ? LooseStub<BbSdk[K]>
    : { [M in keyof BbSdk[K]]?: LooseStub<BbSdk[K][M]> };
};

export interface FakeSdkHarness {
  /** Every `bb.sdk` call in order, including ones whose stub threw. */
  readonly calls: FakeSdkCall[];
  /** Argument lists of the calls to one dot-joined path. */
  callsTo(path: string): unknown[][];
  /** Add or replace one method's implementation after creation. */
  stub(path: string, implementation: (...args: never[]) => unknown): void;
}

/**
 * Mirrors the server's `wrapSdkForPlugin`: `threads.spawn` defaults
 * `origin` to "plugin" and `originPluginId` to the plugin's id unless the
 * caller set them explicitly.
 */
function withSpawnAttribution(pluginId: string, args: unknown[]): unknown[] {
  const [first, ...rest] = args;
  if (typeof first !== "object" || first === null) return args;
  const spawnArgs = first as { origin?: string; originPluginId?: string };
  const origin = spawnArgs.origin ?? "plugin";
  return [
    {
      ...spawnArgs,
      origin,
      ...(origin === "plugin"
        ? { originPluginId: spawnArgs.originPluginId ?? pluginId }
        : {}),
    },
    ...rest,
  ];
}

export function createFakeSdk(options: {
  pluginId: string;
  overrides?: FakeSdkOverrides;
}): { sdk: BbSdk; harness: FakeSdkHarness } {
  const calls: FakeSdkCall[] = [];
  const stubs = new Map<string, (...args: unknown[]) => unknown>();

  for (const [key, value] of Object.entries(options.overrides ?? {})) {
    if (typeof value === "function") {
      stubs.set(key, value as (...args: unknown[]) => unknown);
      continue;
    }
    for (const [method, implementation] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (typeof implementation === "function") {
        stubs.set(
          `${key}.${method}`,
          implementation as (...args: unknown[]) => unknown,
        );
      }
    }
  }

  function invoke(path: string, rawArgs: unknown[]): unknown {
    const args =
      path === "threads.spawn"
        ? withSpawnAttribution(options.pluginId, rawArgs)
        : rawArgs;
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
  /** Callable-and-traversable proxy: `sdk.threads.spawn(...)` and `sdk.on(...)` both work. */
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
      return calls.filter((call) => call.path === path).map((call) => call.args);
    },
    stub(path, implementation) {
      stubs.set(path, implementation as (...args: unknown[]) => unknown);
    },
  };

  // The proxy is the genuinely unknowable boundary: it answers any BbSdk
  // shape at runtime, and the type is re-imposed here once.
  return { sdk: node("") as BbSdk, harness };
}
