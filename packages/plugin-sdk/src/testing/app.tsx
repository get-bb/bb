import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import { act, render, type RenderResult } from "@testing-library/react";
import {
  type BbContext,
  type BbNavigate,
  type PluginAppDefinition,
  type PluginAppSetup,
  type PluginComposerAccessoryRegistration,
  type PluginComposerApi,
  type PluginComposerMention,
  type PluginFileOpenerRegistration,
  type PluginHomepageSectionRegistration,
  type PluginMessageDirectiveRegistration,
  type PluginNavPanelRegistration,
  type PluginPendingInteractionRegistration,
  type PluginRpcClient,
  type PluginSdkApp,
  type PluginSettingsSectionRegistration,
  type PluginSettingsState,
  type PluginSidebarFooterActionRegistration,
  type PluginThreadPanelActionRegistration,
} from "../app-contract.js";
import type {
  PluginRpcContract,
  PluginRpcResult,
  StandardSchemaV1InferInput,
} from "../rpc-contract.js";
import type { JsonValue } from "../json-value.js";

/**
 * `@bb/plugin-sdk/testing/app` — the frontend plugin test harness. Tests a
 * plugin's `app.tsx` source directly under vitest + jsdom, without the bb
 * host or the esbuild bundle:
 *
 * - {@link installTestPluginRuntime} fills `globalThis.__bbPluginRuntime.
 *   pluginSdkApp` with a test implementation of the `@bb/plugin-sdk/app`
 *   surface (the same seam `bb plugin build` shims to the real app). It must
 *   run BEFORE the plugin's `app.tsx` module evaluates, because that module
 *   binds the runtime at import time — so import `app.tsx` through
 *   {@link loadPluginApp}'s thunk form, or call the installer from a vitest
 *   setup file when you prefer static imports.
 * - {@link loadPluginApp} runs the definition's setup against a validating
 *   collector (ported from the BB app's interpreter, same error messages)
 *   and returns the typed slot registrations.
 * - {@link renderSlot} mounts one registration's component with mock hook
 *   backends: rpc as a method→handler map with a call log, realtime as a
 *   channel you can push events into, settings/context as plain values, and
 *   navigate/composer as recorders.
 *
 * Add `// @vitest-environment jsdom` to test files using renderSlot.
 */

// ---------------------------------------------------------------------------
// The test-side hook environment (one per renderSlot mount).
// ---------------------------------------------------------------------------

export interface RpcCall {
  method: string;
  input: unknown;
}

export type NavigateCall =
  | { method: "toThread"; threadId: string }
  | { method: "toProject"; projectId: string }
  | {
      method: "toPluginPanel";
      path: string;
      options?: { subPath?: string; replace?: boolean };
    }
  | {
      method: "toCompose";
      options?: { initialPrompt?: string; focusPrompt?: boolean };
    };

export interface ComposerLog {
  quotes: string[];
  mentions: PluginComposerMention[];
  focusCount: number;
}

interface SlotEnv {
  rpcClient: PluginRpcClient;
  rpcCalls: RpcCall[];
  realtimeHandlers: Map<string, Set<(payload: unknown) => void>>;
  settingsState: PluginSettingsState;
  bbContext: BbContext;
  navigate: BbNavigate;
  navigateCalls: NavigateCall[];
  composer: PluginComposerApi;
  composerLog: ComposerLog;
}

const SlotEnvContext = createContext<SlotEnv | null>(null);

function useSlotEnv(hook: string): SlotEnv {
  const env = useContext(SlotEnvContext);
  if (!env) {
    throw new Error(
      `${hook}() needs the test slot environment — mount the component via renderSlot(...) from @bb/plugin-sdk/testing/app`,
    );
  }
  return env;
}

// ---------------------------------------------------------------------------
// The fake @bb/plugin-sdk/app runtime.
// ---------------------------------------------------------------------------

/** Same shape (and checks) as the BB app's real definePluginApp. */
function definePluginApp(setup: PluginAppSetup): PluginAppDefinition {
  if (typeof setup !== "function") {
    throw new Error("definePluginApp expects a setup function");
  }
  return Object.freeze({ __bbPluginApp: true as const, setup });
}

function isPluginAppDefinition(value: unknown): value is PluginAppDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __bbPluginApp?: unknown }).__bbPluginApp === true &&
    typeof (value as { setup?: unknown }).setup === "function"
  );
}

const PLUGIN_SLOT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PLUGIN_MESSAGE_DIRECTIVE_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const testPluginSdkApp = {
  definePluginApp,
  useRpc<
    Contract extends PluginRpcContract = PluginRpcContract,
  >(): PluginRpcClient<Contract> {
    return useSlotEnv("useRpc").rpcClient as PluginRpcClient<Contract>;
  },
  useRealtime(channel: string, handler: (payload: unknown) => void): void {
    const env = useSlotEnv("useRealtime");
    // Latest handler without resubscribing per render, like the host hook.
    const handlerRef = useRef(handler);
    useEffect(() => {
      handlerRef.current = handler;
    });
    useEffect(() => {
      const listener = (payload: unknown) => handlerRef.current(payload);
      let listeners = env.realtimeHandlers.get(channel);
      if (!listeners) {
        listeners = new Set();
        env.realtimeHandlers.set(channel, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }, [env, channel]);
  },
  useSettings(): PluginSettingsState {
    return useSlotEnv("useSettings").settingsState;
  },
  useBbContext(): BbContext {
    return useSlotEnv("useBbContext").bbContext;
  },
  useBbNavigate(): BbNavigate {
    return useSlotEnv("useBbNavigate").navigate;
  },
  useComposer(): PluginComposerApi {
    return useSlotEnv("useComposer").composer;
  },
} satisfies PluginSdkApp;

interface PluginRuntimeHost {
  __bbPluginRuntime?: { pluginSdkApp?: unknown };
}

/**
 * Install the test runtime at `globalThis.__bbPluginRuntime.pluginSdkApp`.
 * Idempotent per module instance; must run before the plugin's `app.tsx`
 * (and therefore `@bb/plugin-sdk/app`) is imported.
 */
export function installTestPluginRuntime(): void {
  const host = globalThis as PluginRuntimeHost;
  host.__bbPluginRuntime = {
    ...host.__bbPluginRuntime,
    pluginSdkApp: testPluginSdkApp,
  };
}

// ---------------------------------------------------------------------------
// loadPluginApp — run setup, capture typed slot registrations.
// ---------------------------------------------------------------------------

export interface CapturedPluginApp {
  homepageSections: PluginHomepageSectionRegistration[];
  settingsSections: PluginSettingsSectionRegistration[];
  navPanels: PluginNavPanelRegistration[];
  threadPanelActions: PluginThreadPanelActionRegistration[];
  composerAccessories: PluginComposerAccessoryRegistration[];
  pendingInteractions: PluginPendingInteractionRegistration[];
  sidebarFooterActions: PluginSidebarFooterActionRegistration[];
  fileOpeners: PluginFileOpenerRegistration[];
  messageDirectives: PluginMessageDirectiveRegistration[];
}

type PluginAppModule = { default: unknown };

export type PluginAppSource =
  | PluginAppDefinition
  | PluginAppModule
  | (() => Promise<PluginAppDefinition | PluginAppModule>);

function requireSlotId(kind: string, value: unknown): string {
  if (typeof value !== "string" || !PLUGIN_SLOT_ID_PATTERN.test(value)) {
    throw new Error(
      `${kind}: "id" must match ${String(PLUGIN_SLOT_ID_PATTERN)}, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function requireMessageDirectiveId(kind: string, value: unknown): string {
  if (
    typeof value !== "string" ||
    !PLUGIN_MESSAGE_DIRECTIVE_ID_PATTERN.test(value)
  ) {
    throw new Error(
      `${kind}: "id" must match ${String(PLUGIN_MESSAGE_DIRECTIVE_ID_PATTERN)}, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function requireNonEmptyString(
  kind: string,
  field: string,
  value: unknown,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${kind}: "${field}" must be a non-empty string`);
  }
  return value;
}

function requireOptionalString(
  kind: string,
  field: string,
  value: unknown,
): string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${kind}: "${field}" must be a string when set`);
  }
  return value;
}

function requireComponent<T>(kind: string, value: unknown): T {
  if (typeof value !== "function") {
    throw new Error(`${kind}: "component" must be a React component function`);
  }
  return value as T;
}

function requireUniqueId(kind: string, seen: Set<string>, id: string): void {
  if (seen.has(id)) {
    throw new Error(`${kind}: duplicate id "${id}"`);
  }
  seen.add(id);
}

/**
 * Validation ported from the BB app's collector
 * (apps/app/src/lib/plugin-app-definition.ts) so a registration the host
 * would reject fails here with the same message.
 */
function collectRegistrations(
  definition: PluginAppDefinition,
): CapturedPluginApp {
  const captured: CapturedPluginApp = {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerAccessories: [],
    pendingInteractions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
  };
  const seenIds = {
    homepageSection: new Set<string>(),
    settingsSection: new Set<string>(),
    navPanel: new Set<string>(),
    threadPanelAction: new Set<string>(),
    composerAccessory: new Set<string>(),
    pendingInteraction: new Set<string>(),
    sidebarFooterAction: new Set<string>(),
    fileOpener: new Set<string>(),
    messageDirective: new Set<string>(),
  };

  definition.setup({
    slots: {
      homepageSection(registration) {
        const kind = "slots.homepageSection";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.homepageSection, id);
        captured.homepageSections.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          component: requireComponent(kind, registration.component),
        });
      },
      settingsSection(registration) {
        const kind = "slots.settingsSection";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.settingsSection, id);
        const title = requireOptionalString(kind, "title", registration.title);
        const description = requireOptionalString(
          kind,
          "description",
          registration.description,
        );
        captured.settingsSections.push({
          id,
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          component: requireComponent(kind, registration.component),
        });
      },
      navPanel(registration) {
        const kind = "slots.navPanel";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.navPanel, id);
        const path = requireNonEmptyString(kind, "path", registration.path);
        if (!PLUGIN_SLOT_ID_PATTERN.test(path)) {
          throw new Error(
            `${kind}: "path" must match ${String(PLUGIN_SLOT_ID_PATTERN)} (it becomes a URL segment), got ${JSON.stringify(path)}`,
          );
        }
        if (
          registration.headerContent !== undefined &&
          typeof registration.headerContent !== "function"
        ) {
          throw new Error(
            `${kind}: "headerContent" must be a React component function when set`,
          );
        }
        captured.navPanels.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          icon: requireNonEmptyString(kind, "icon", registration.icon),
          path,
          component: requireComponent(kind, registration.component),
          ...(registration.headerContent !== undefined
            ? { headerContent: registration.headerContent }
            : {}),
        });
      },
      threadPanelAction(registration) {
        const kind = "slots.threadPanelAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.threadPanelAction, id);
        if (
          registration.run !== undefined &&
          typeof registration.run !== "function"
        ) {
          throw new Error(`${kind}: "run" must be a function when set`);
        }
        captured.threadPanelActions.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          ...(registration.icon !== undefined
            ? { icon: requireNonEmptyString(kind, "icon", registration.icon) }
            : {}),
          component: requireComponent(kind, registration.component),
          ...(registration.run !== undefined ? { run: registration.run } : {}),
        });
      },
      composerAccessory(registration) {
        const kind = "slots.composerAccessory";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.composerAccessory, id);
        captured.composerAccessories.push({
          id,
          component: requireComponent(kind, registration.component),
        });
      },
      pendingInteraction(registration) {
        const kind = "slots.pendingInteraction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.pendingInteraction, id);
        captured.pendingInteractions.push({
          id,
          component: requireComponent(kind, registration.component),
        });
      },
      sidebarFooterAction(registration) {
        const kind = "slots.sidebarFooterAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.sidebarFooterAction, id);
        if (typeof registration.run !== "function") {
          throw new Error(`${kind}: "run" must be a function`);
        }
        captured.sidebarFooterActions.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          icon: requireNonEmptyString(kind, "icon", registration.icon),
          run: registration.run,
        });
      },
      fileOpener(registration) {
        const kind = "slots.fileOpener";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.fileOpener, id);
        const rawExtensions = registration?.extensions;
        if (!Array.isArray(rawExtensions) || rawExtensions.length === 0) {
          throw new Error(
            `${kind}: "extensions" must be a non-empty array of lowercase extensions without the dot`,
          );
        }
        const extensions = rawExtensions.map((extension) => {
          if (typeof extension !== "string" || !/^[a-z0-9]+$/.test(extension)) {
            throw new Error(
              `${kind}: extensions must be lowercase alphanumerics without the dot, got ${JSON.stringify(extension)}`,
            );
          }
          return extension;
        });
        captured.fileOpeners.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          extensions,
          component: requireComponent(kind, registration.component),
        });
      },
      messageDirective(registration) {
        const kind = "slots.messageDirective";
        const id = requireMessageDirectiveId(kind, registration?.id);
        requireUniqueId(kind, seenIds.messageDirective, id);
        captured.messageDirectives.push({
          id,
          component: requireComponent(kind, registration.component),
        });
      },
    },
  });

  return captured;
}

/**
 * Install the test runtime, resolve the plugin app definition, and capture
 * its slot registrations. Pass a thunk (`() => import("../app.tsx")`) so the
 * plugin module evaluates after the runtime is installed — a static import
 * would bind `definePluginApp` before the installer runs.
 */
export async function loadPluginApp(
  source: PluginAppSource,
): Promise<CapturedPluginApp> {
  installTestPluginRuntime();
  const resolved = typeof source === "function" ? await source() : source;
  const definition = isPluginAppDefinition(resolved)
    ? resolved
    : (resolved as PluginAppModule).default;
  if (!isPluginAppDefinition(definition)) {
    throw new Error(
      "the bundle's default export is not definePluginApp(...) from @bb/plugin-sdk/app",
    );
  }
  return collectRegistrations(definition);
}

// ---------------------------------------------------------------------------
// renderSlot — mount one registration's component with mock hook backends.
// ---------------------------------------------------------------------------

export type PluginRpcTestHandlers<Contract extends PluginRpcContract> = {
  [Method in keyof Contract]: (
    input: StandardSchemaV1InferInput<Contract[Method]["input"]>,
  ) =>
    | PluginRpcResult<Contract[Method]>
    | Promise<PluginRpcResult<Contract[Method]>>;
};

export interface RenderSlotOptions<
  Contract extends PluginRpcContract = PluginRpcContract,
> {
  /**
   * Backing handlers for `useRpc().call`: method name → implementation.
   * Inputs and results are JSON-round-tripped like the wire; a method
   * without a handler rejects, and a throwing handler rejects with its
   * message (what the real rpc client surfaces).
   */
  rpc?: PluginRpcTestHandlers<Contract>;
  /** `useSettings()` values; omitted → `{ values: undefined, isLoading: false }`. */
  settings?: Record<string, string | boolean>;
  /** `useBbContext()` selection; both default to null. */
  context?: { projectId?: string | null; threadId?: string | null };
}

export interface RenderedSlot extends RenderResult {
  /** Every `useRpc().call`, in order. */
  rpcCalls: RpcCall[];
  /**
   * Push a realtime event to `useRealtime(channel, …)` subscribers, wrapped
   * in act. The payload is JSON-round-tripped like `bb.realtime.publish`.
   */
  emitRealtime(channel: string, payload: unknown): Promise<void>;
  /** Every `useBbNavigate()` call, in order. */
  navigateCalls: NavigateCall[];
  /** Everything written through `useComposer()`. */
  composer: ComposerLog;
}

function strictJsonRoundTrip(value: unknown, label: string): JsonValue {
  const ancestors = new Set<object>();
  function visit(current: unknown, path: string): void {
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new Error(`${label} at ${path} contains a non-finite number`);
      }
      return;
    }
    if (typeof current !== "object") {
      throw new Error(`${label} at ${path} is not a JSON value`);
    }
    if (ancestors.has(current)) {
      throw new Error(`${label} at ${path} is cyclic`);
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        current.forEach((item, index) => visit(item, `${path}[${index}]`));
        return;
      }
      const prototype = Object.getPrototypeOf(current) as object | null;
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(`${label} at ${path} must be a plain JSON object`);
      }
      if (Reflect.ownKeys(current).some((key) => typeof key === "symbol")) {
        throw new Error(`${label} at ${path} contains a symbol key`);
      }
      for (const [key, child] of Object.entries(current)) {
        visit(child, `${path}.${key}`);
      }
    } finally {
      ancestors.delete(current);
    }
  }
  visit(value, "$");
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function renderSlot<
  Props extends object,
  Contract extends PluginRpcContract = PluginRpcContract,
>(
  registration: { component: ComponentType<Props> },
  props: Props,
  options: RenderSlotOptions<Contract> = {},
): RenderedSlot {
  const rpcCalls: RpcCall[] = [];
  const rpcHandlers = (options.rpc ?? {}) as Record<
    string,
    (input: unknown) => unknown
  >;
  const rpcClient: PluginRpcClient = {
    async call(method, input) {
      const normalizedInput =
        input === undefined
          ? null
          : strictJsonRoundTrip(input, `rpc "${method}" input`);
      rpcCalls.push({ method, input: normalizedInput });
      const handler = rpcHandlers[method];
      if (!handler) {
        throw new Error(
          `no rpc handler for "${method}" — add it to renderSlot options.rpc`,
        );
      }
      const result = await handler(normalizedInput);
      return strictJsonRoundTrip(result, `rpc "${method}" result`);
    },
  };

  const realtimeHandlers = new Map<string, Set<(payload: unknown) => void>>();

  const navigateCalls: NavigateCall[] = [];
  const navigate: BbNavigate = {
    toThread(threadId) {
      navigateCalls.push({ method: "toThread", threadId });
    },
    toProject(projectId) {
      navigateCalls.push({ method: "toProject", projectId });
    },
    toPluginPanel(path, panelOptions) {
      navigateCalls.push({
        method: "toPluginPanel",
        path,
        ...(panelOptions !== undefined ? { options: panelOptions } : {}),
      });
    },
    toCompose(composeOptions) {
      navigateCalls.push({
        method: "toCompose",
        ...(composeOptions !== undefined ? { options: composeOptions } : {}),
      });
    },
  };

  const projectId = options.context?.projectId ?? null;
  const threadId = options.context?.threadId ?? null;

  const composerLog: ComposerLog = {
    quotes: [],
    mentions: [],
    focusCount: 0,
  };
  const composer: PluginComposerApi = {
    scope:
      threadId !== null
        ? { kind: "thread", threadId }
        : { kind: "new-thread", projectId },
    addQuote(text) {
      composerLog.quotes.push(text);
    },
    insertMention(mention) {
      composerLog.mentions.push(mention);
    },
    focus() {
      composerLog.focusCount += 1;
    },
  };

  const env: SlotEnv = {
    rpcClient,
    rpcCalls,
    realtimeHandlers,
    settingsState: { values: options.settings, isLoading: false },
    bbContext: { projectId, threadId },
    navigate,
    navigateCalls,
    composer,
    composerLog,
  };

  const Component = registration.component;
  const element: ReactElement = (
    <SlotEnvContext.Provider value={env}>
      <Component {...props} />
    </SlotEnvContext.Provider>
  );
  const result = render(element);

  return {
    ...result,
    rerender(ui: ReactNode) {
      result.rerender(
        <SlotEnvContext.Provider value={env}>{ui}</SlotEnvContext.Provider>,
      );
    },
    rpcCalls,
    async emitRealtime(channel, payload) {
      const normalized =
        payload === undefined
          ? null
          : strictJsonRoundTrip(payload, `realtime "${channel}" payload`);
      const listeners = realtimeHandlers.get(channel);
      await act(async () => {
        for (const listener of [...(listeners ?? [])]) {
          listener(normalized);
        }
      });
    },
    navigateCalls,
    composer: composerLog,
  };
}
