import type {
  HookPolicy,
  Operation,
  OperationCaller,
  OperationKind,
} from "./contract.js";

export type HookTier = "policy" | "installed" | "product";
export type OperationErrorCode =
  | "denied"
  | "unimplemented"
  | "unknown_operation"
  | "invalid_input"
  | "invalid_output";

export class OperationError extends Error {
  readonly code: OperationErrorCode;
  readonly plugin: string | null;

  constructor(
    code: OperationErrorCode,
    message: string,
    plugin: string | null = null,
  ) {
    super(message);
    this.name = "OperationError";
    this.code = code;
    this.plugin = plugin;
  }
}

class HookRefusal extends Error {}

export function deny(reason: string): never {
  throw new HookRefusal(reason);
}

export interface Next<Input, Output> {
  (input?: Input): Promise<Output>;
  readonly origin: OperationCaller;
}

export type Hook<Input = unknown, Output = unknown> = (
  input: Input,
  next: Next<Input, Output>,
) => Output | Promise<Output>;

export interface Vote {
  plugin: string;
  value: unknown;
}

export interface CallContext<Http> {
  caller: OperationCaller;
  signal: AbortSignal;
  http: Http | null;
  votes: readonly Vote[];
  extra: unknown;
}

export type Implementation<Input, Output, Http> = (
  input: Input,
  context: CallContext<Http>,
) => Output | Promise<Output>;

export interface HookOptions {
  match?: Readonly<Record<string, unknown>>;
  failClosed?: boolean;
}

export interface CallOptions<Http> {
  caller?: OperationCaller;
  signal?: AbortSignal;
  http?: Http;
  extra?: unknown;
}

export interface OperationScope<Http> {
  readonly plugin: string;
  implement<Input, Output>(
    operation: Operation<Input, Output>,
    implementation: Implementation<Input, Output, Http>,
  ): () => void;
  hook(name: string, hook: Hook, options?: HookOptions): () => void;
  call(
    target: string | Operation,
    input: unknown,
    options?: CallOptions<Http>,
  ): Promise<unknown>;
  dispose(): void;
}

export interface OperationInspection {
  name: string;
  kind: OperationKind;
  hooks: HookPolicy;
  owner: string | null;
  internal: boolean;
  doors: string[];
  http: { method: string; path: string } | null;
  cli: string | null;
  chain: {
    plugin: string;
    tier: HookTier;
    failClosed: boolean;
    match: Readonly<Record<string, unknown>> | null;
  }[];
}

export interface KernelOptions {
  currentCaller(): OperationCaller | null;
  enter<T>(caller: OperationCaller, work: () => T): T;
  warn?(message: string, fields: Record<string, unknown>): void;
  isolateHook?<T>(
    plugin: string,
    label: string,
    run: () => Promise<T>,
  ): Promise<T>;
  hookBudgetMs?: number;
}

export interface OperationKernel<Http> {
  define(operation: Operation): () => void;
  implement<Input, Output>(
    operation: Operation<Input, Output>,
    implementation: Implementation<Input, Output, Http>,
  ): () => void;
  scope(plugin: string, tier: HookTier): OperationScope<Http>;
  call(
    target: string | Operation,
    input: unknown,
    options?: CallOptions<Http>,
  ): Promise<unknown>;
  operation(name: string): Operation | null;
  hasHooks(name: string): boolean;
  operations(): Operation[];
  inspect(): OperationInspection[];
}

export const CORE_OWNER = "core";
export const SYSTEM_CALLER: OperationCaller = Object.freeze({
  user: "system",
  door: "system",
  thread: null,
  via: Object.freeze([]),
});

const TIER_RANK: Record<HookTier, number> = {
  policy: 0,
  installed: 1,
  product: 2,
};
const DEFAULT_HOOK_BUDGET_MS = 10_000;
const UNSETTLED = Symbol("unsettled");

type HookResult = { value: unknown } | { passed: unknown };

interface HookEntry {
  plugin: string;
  tier: HookTier;
  order: number;
  match: Readonly<Record<string, unknown>> | null;
  run: Hook;
  failClosed: boolean;
}

interface OwnerEntry<Http> {
  plugin: string;
  run: Implementation<unknown, unknown, Http>;
}

function matches(
  match: Readonly<Record<string, unknown>> | null,
  value: unknown,
): boolean {
  if (match === null) return true;
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(match).every(([key, expected]) => {
    const actual: unknown = Reflect.get(value, key);
    if (typeof expected === "object" && expected !== null) {
      return matches(expected as Readonly<Record<string, unknown>>, actual);
    }
    return actual === expected;
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ranked(entries: readonly HookEntry[]): HookEntry[] {
  return [...entries].sort(
    (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.order - b.order,
  );
}

function stopwatch(budgetMs: number) {
  let spent = 0;
  let startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expire = () => {};
  const expired = new Promise<never>((_resolve, reject) => {
    expire = () => reject(new Error(`ran past its ${budgetMs} ms budget`));
  });
  expired.catch(() => {});
  let stopped = false;
  const resume = () => {
    if (stopped) return;
    startedAt = Date.now();
    timer = setTimeout(expire, Math.max(budgetMs - spent, 0));
  };
  const pause = () => {
    clearTimeout(timer);
    spent += Date.now() - startedAt;
  };
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
  };
  resume();
  return { expired, pause, resume, stop };
}

export function createOperationKernel<Http>(
  options: KernelOptions,
): OperationKernel<Http> {
  const definitions = new Map<string, Operation>();
  const owners = new Map<string, OwnerEntry<Http>>();
  const chains = new Map<string, HookEntry[]>();
  const budgetMs = options.hookBudgetMs ?? DEFAULT_HOOK_BUDGET_MS;
  const warn = options.warn ?? (() => {});
  const neverAborted = new AbortController().signal;
  const locks = new Map<string, Promise<void>>();
  let order = 0;

  const currentCaller = (): OperationCaller =>
    options.currentCaller() ?? SYSTEM_CALLER;

  const isolate = <T>(plugin: string, label: string, run: () => Promise<T>) =>
    options.isolateHook === undefined
      ? run()
      : options.isolateHook(plugin, label, run);

  function define(operation: Operation): () => void {
    const known = definitions.get(operation.name);
    if (known !== undefined && known !== operation) {
      throw new Error(`${operation.name} is already defined`);
    }
    definitions.set(operation.name, operation);
    return () => {
      if (definitions.get(operation.name) === operation) {
        definitions.delete(operation.name);
      }
    };
  }

  function claim(
    plugin: string,
    operation: Operation,
    run: Implementation<unknown, unknown, Http>,
  ): () => void {
    const held = owners.get(operation.name);
    if (held !== undefined) {
      throw new Error(
        `${operation.name} is already implemented by ${held.plugin}`,
      );
    }
    const undefine = definitions.has(operation.name)
      ? () => {}
      : define(operation);
    const entry: OwnerEntry<Http> = { plugin, run };
    owners.set(operation.name, entry);
    return () => {
      if (owners.get(operation.name) !== entry) return;
      owners.delete(operation.name);
      undefine();
    };
  }

  function addHook(
    plugin: string,
    tier: HookTier,
    name: string,
    run: Hook,
    hookOptions: HookOptions,
  ): () => void {
    const operation = definitions.get(name);
    const refusable =
      operation === undefined ||
      operation.hooks === "answer" ||
      operation.hooks === "vote";
    if (hookOptions.failClosed === true && !refusable) {
      throw new Error(`${name} cannot be refused by a hook`);
    }
    order += 1;
    const entry: HookEntry = {
      plugin,
      tier,
      order,
      match: hookOptions.match ?? null,
      run,
      failClosed: hookOptions.failClosed === true,
    };
    const chain = chains.get(name) ?? [];
    chain.push(entry);
    chains.set(name, chain);
    return () => {
      const list = chains.get(name);
      if (list === undefined) return;
      const index = list.indexOf(entry);
      if (index >= 0) list.splice(index, 1);
      if (list.length === 0) chains.delete(name);
    };
  }

  async function run(
    operation: Operation,
    raw: unknown,
    caller: OperationCaller,
    signal: AbortSignal,
    http: Http | null,
    extra: unknown,
  ): Promise<unknown> {
    const accepted = await operation.parse(raw);
    const chain = ranked(chains.get(operation.name) ?? []);
    let producer: string | null = null;

    const owner = async (input: unknown): Promise<unknown> => {
      const entry = owners.get(operation.name);
      if (entry === undefined) {
        throw new OperationError(
          "unimplemented",
          `Nothing implements ${operation.name}`,
        );
      }
      return entry.run(input, { caller, signal, http, votes, extra });
    };
    const votes: Vote[] = [];

    const vote = async (input: unknown): Promise<unknown> => {
      const refuse = (plugin: string, detail: string): Error =>
        operation.hookFailure === undefined
          ? new OperationError(
              "denied",
              `${plugin} could not check ${operation.name}: ${detail}`,
              plugin,
            )
          : operation.hookFailure(plugin, detail);
      const unavailable = Object.assign(
        () =>
          Promise.reject(
            new Error(`a hook on ${operation.name} votes and has no next`),
          ),
        { origin: caller },
      );
      for (const entry of chain) {
        if (!matches(entry.match, input)) continue;
        const { plugin } = entry;
        const watch = stopwatch(budgetMs);
        let value: unknown;
        try {
          value = await Promise.race([
            isolate(plugin, `hook ${operation.name}`, () =>
              Promise.resolve(entry.run(input, unavailable)),
            ),
            watch.expired,
          ]);
        } catch (error) {
          throw refuse(plugin, messageOf(error));
        } finally {
          watch.stop();
        }
        const problem = operation.checkVote?.(value) ?? null;
        if (problem !== null) {
          throw refuse(plugin, `returned an invalid decision: ${problem}`);
        }
        votes.push({ plugin, value });
        if (operation.stopVoting?.(value) === true) break;
      }
      return owner(input);
    };

    const dispatch = async (
      index: number,
      input: unknown,
    ): Promise<unknown> => {
      const entry = chain[index];
      if (entry === undefined) return owner(input);
      if (!matches(entry.match, input)) return dispatch(index + 1, input);
      const { plugin } = entry;
      const flight: { beneath: Promise<unknown> | null } = { beneath: null };
      const watch = stopwatch(budgetMs);
      const forward = (replacement: unknown = input) => {
        if (flight.beneath !== null) return flight.beneath;
        const passed = operation.hooks === "observe" ? input : replacement;
        watch.pause();
        const beneath = dispatch(index + 1, passed);
        beneath.then(watch.resume, watch.resume);
        flight.beneath = beneath;
        return beneath;
      };
      const next = Object.assign(forward, { origin: caller });
      try {
        const hooked = isolate(
          plugin,
          `hook ${operation.name}`,
          async (): Promise<HookResult> => {
            try {
              return { value: await entry.run(input, next) };
            } catch (error) {
              if (error instanceof HookRefusal) return { passed: error };
              const beneath = flight.beneath;
              if (beneath === null) throw error;
              const failure = await beneath.then(
                () => UNSETTLED,
                (reason: unknown) => reason,
              );
              if (failure === error) return { passed: error };
              throw error;
            }
          },
        );
        const settled = await Promise.race([hooked, watch.expired]);
        if ("passed" in settled) throw settled.passed;
        const answer = settled.value;
        if (flight.beneath === null) {
          if (operation.hooks !== "answer") {
            throw new Error(`a hook on ${operation.name} must call next`);
          }
          producer = plugin;
          return answer;
        }
        const result = await flight.beneath;
        if (operation.hooks === "observe") return result;
        if (answer !== result) producer = plugin;
        return answer;
      } catch (error) {
        const pending = flight.beneath;
        const failure =
          pending === null
            ? UNSETTLED
            : await pending.then(
                () => UNSETTLED,
                (reason: unknown) => reason,
              );
        if (failure !== UNSETTLED && failure === error) throw error;
        if (error instanceof HookRefusal && operation.hooks === "answer") {
          throw new OperationError("denied", error.message, plugin);
        }
        const reason = messageOf(error);
        warn("An operation hook failed", {
          plugin,
          operation: operation.name,
          reason,
        });
        if (entry.failClosed && operation.hooks === "answer") {
          throw new OperationError(
            "denied",
            `${plugin} could not check ${operation.name}: ${reason}`,
            plugin,
          );
        }
        return pending ?? dispatch(index + 1, input);
      } finally {
        watch.stop();
      }
    };

    let result =
      operation.hooks === "vote"
        ? await vote(accepted)
        : await dispatch(0, accepted);
    if (producer !== null && operation.checkOutput !== undefined) {
      const problem = operation.checkOutput(result);
      if (problem !== null) {
        throw new OperationError(
          "invalid_output",
          `${producer} returned an invalid result for ${operation.name}: ${problem}`,
          producer,
        );
      }
    }
    if (operation.finish !== undefined) {
      result = await operation.finish(result, accepted);
    }
    return result;
  }

  function resolve(target: string | Operation): Operation {
    if (typeof target !== "string") return target;
    const operation = definitions.get(target);
    if (operation === undefined) {
      throw new OperationError(
        "unknown_operation",
        `Unknown operation ${target}`,
      );
    }
    return operation;
  }

  function callAs(
    target: string | Operation,
    input: unknown,
    callOptions: CallOptions<Http>,
    caller: OperationCaller,
  ): Promise<unknown> {
    const operation = resolve(target);
    const signal = callOptions.signal ?? neverAborted;
    const http = callOptions.http ?? null;
    const extra = callOptions.extra;
    const work = () => run(operation, input, caller, signal, http, extra);
    if (!operation.serialized) return options.enter(caller, work);
    const previous = locks.get(operation.name) ?? Promise.resolve();
    const result = previous.then(
      () => options.enter(caller, work),
      () => options.enter(caller, work),
    );
    locks.set(
      operation.name,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  function scope(plugin: string, tier: HookTier): OperationScope<Http> {
    const undo: (() => void)[] = [];
    let live = true;
    const alive = () => {
      if (!live) throw new Error(`Plugin "${plugin}" was unloaded`);
    };
    const remember = (revert: () => void) => {
      undo.push(revert);
      return () => {
        const index = undo.indexOf(revert);
        if (index >= 0) undo.splice(index, 1);
        revert();
      };
    };
    return {
      plugin,
      implement(operation, implementation) {
        alive();
        return remember(
          claim(
            plugin,
            operation,
            implementation as Implementation<unknown, unknown, Http>,
          ),
        );
      },
      hook(name, hook, hookOptions = {}) {
        alive();
        return remember(addHook(plugin, tier, name, hook, hookOptions));
      },
      call(target, input, callOptions = {}) {
        alive();
        const operation = resolve(target);
        const base = callOptions.caller ?? currentCaller();
        const mine = owners.get(operation.name)?.plugin === plugin;
        const caller =
          mine || base.via.at(-1) === plugin
            ? base
            : { ...base, via: [...base.via, plugin] };
        return callAs(operation, input, callOptions, caller);
      },
      dispose() {
        if (!live) return;
        live = false;
        for (const revert of undo.reverse()) revert();
        undo.length = 0;
      },
    };
  }

  return {
    define,
    implement(operation, implementation) {
      return claim(
        CORE_OWNER,
        operation,
        implementation as Implementation<unknown, unknown, Http>,
      );
    },
    scope,
    call(target, input, callOptions = {}) {
      return callAs(
        target,
        input,
        callOptions,
        callOptions.caller ?? currentCaller(),
      );
    },
    operation: (name) => definitions.get(name) ?? null,
    hasHooks: (name) => (chains.get(name)?.length ?? 0) > 0,
    operations: () => [...definitions.values()],
    inspect() {
      return [...definitions.values()]
        .map((operation) => {
          const { http, cli } = operation.doors;
          return {
            name: operation.name,
            kind: operation.kind,
            hooks: operation.hooks,
            owner: owners.get(operation.name)?.plugin ?? null,
            internal: operation.internal,
            doors: Object.keys(operation.doors).sort(),
            http:
              http === undefined
                ? null
                : { method: http.method.toUpperCase(), path: http.path },
            cli: cli === undefined ? null : cli.path.join(" "),
            chain: ranked(chains.get(operation.name) ?? []).map(
              ({ plugin, tier, failClosed, match }) => ({
                plugin,
                tier,
                failClosed,
                match,
              }),
            ),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}
