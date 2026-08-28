import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

type BbSdk = BbPluginApi["sdk"];

type FakeSdkPrimitive =
  | string
  | number
  | boolean
  | symbol
  | bigint
  | null
  | undefined;
type FakeSdkValue = FakeSdkPrimitive | object;
type FakeSdkResult = FakeSdkValue | Promise<FakeSdkValue | void> | void;
type FakeSdkArguments = FakeSdkValue[];
type FakeSdkFunction = (...args: FakeSdkArguments) => FakeSdkResult;

interface FakeSdkNode {
  (...args: FakeSdkArguments): FakeSdkResult;
  [key: string]: FakeSdkNode;
}

interface FakeSdk {
  sdk: BbSdk;
  harness: FakeSdkHarness;
}

/**
 * Recordable `bb.sdk` stand-in for {@link createFakePluginHost}. Every call
 * through the fake is recorded (post plugin-attribution defaulting, so
 * assertions see what the server would receive); calls without a stubbed
 * implementation throw with a message naming the exact path to stub.
 */

/** One recorded `bb.sdk` call. `path` is dot-joined, e.g. "threads.spawn". */
export interface FakeSdkCall {
  path: string;
  args: FakeSdkArguments;
}

/**
 * A stub keeps the real method's parameter types but may return anything —
 * tests usually only build the fields the plugin reads, not the full wire
 * response.
 */
type LooseStub<F> = F extends (...args: infer A) => infer _Result
  ? (...args: A) => FakeSdkResult
  : never;

/**
 * Stub implementations keyed like `BbSdk`: an object per area with a subset
 * of its methods, or a function for the root-level members (`on`).
 */
type FakeSdkOverrideTree<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => infer _Result
    ? LooseStub<T[K]>
    : FakeSdkOverrideTree<T[K]>;
};

export type FakeSdkOverrides = FakeSdkOverrideTree<BbSdk>;

export interface FakeSdkHarness {
  /** Every `bb.sdk` call in order, including ones whose stub threw. */
  readonly calls: FakeSdkCall[];
  /** Argument lists of the calls to one dot-joined path. */
  callsTo(path: string): FakeSdkCall["args"][];
  /** Add or replace one method's implementation after creation. */
  stub(path: string, implementation: (...args: never[]) => FakeSdkResult): void;
}

/**
 * Mirrors the server's `wrapSdkForPlugin`: `threads.spawn` defaults
 * `origin` to "plugin" and `originPluginId` to the plugin's id unless the
 * caller set them explicitly.
 */
const spawnAttributionSchema = z
  .object({
    origin: z.string().optional(),
    originPluginId: z.string().optional(),
  })
  .passthrough();

function isSdkRecord<T>(value: T): value is T & object {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isSdkFunction<T>(value: T): value is T & FakeSdkFunction {
  return Object.prototype.toString.call(value).endsWith("Function]");
}

function isStringProperty(value: PropertyKey): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function withSpawnAttribution(
  pluginId: string,
  args: FakeSdkArguments,
): FakeSdkArguments {
  const [first, ...rest] = args;
  if (!isSdkRecord(first)) return args;
  const parsed = spawnAttributionSchema.safeParse(first);
  if (!parsed.success) return args;
  const spawnArgs = parsed.data;
  const origin = spawnArgs.origin ?? "plugin";
  const attributed = Object.assign({}, spawnArgs, { origin });
  if (origin === "plugin") {
    return [
      Object.assign(attributed, {
        originPluginId: spawnArgs.originPluginId ?? pluginId,
      }),
      ...rest,
    ];
  }
  return [attributed, ...rest];
}

export function createFakeSdk(options: {
  pluginId: string;
  overrides?: FakeSdkOverrides;
}): FakeSdk {
  const calls: FakeSdkCall[] = [];
  const stubs = new Map<string, FakeSdkFunction>();

  function addOverrides<T>(prefix: string, value: T): void {
    if (isSdkFunction(value)) {
      stubs.set(prefix, value);
      return;
    }
    if (!isSdkRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      addOverrides(prefix.length === 0 ? key : `${prefix}.${key}`, child);
    }
  }
  addOverrides("", options.overrides ?? {});

  function invoke(path: string, rawArgs: FakeSdkArguments): FakeSdkResult {
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

  const nodes = new Map<string, FakeSdkNode>();
  /** Callable-and-traversable proxy: `sdk.threads.spawn(...)` and `sdk.subscribe(...)` both work. */
  function node(path: string): FakeSdkNode {
    const cached = nodes.get(path);
    if (cached) return cached;
    // SAFETY: The proxy handles every property access as another callable fake SDK node.
    const created: FakeSdkNode = new Proxy(
      function (...args: FakeSdkArguments) {
        return invoke(path, args);
      },
      {
        get(_target, prop) {
          // Not thenable: an accidentally awaited node must not hang.
          if (!isStringProperty(prop) || prop === "then") return undefined;
          return node(path === "" ? prop : `${path}.${prop}`);
        },
        apply(_target, _thisArg, args: FakeSdkArguments) {
          return invoke(path, args);
        },
      },
    ) as never;
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
      // SAFETY: The harness accepts a variadic stub and invokes it with recorded SDK arguments.
      stubs.set(path, implementation as FakeSdkFunction);
    },
  };

  // SAFETY: The proxy supplies the dynamic callable tree required by the BbSdk contract.
  return { sdk: node("") as never, harness };
}
