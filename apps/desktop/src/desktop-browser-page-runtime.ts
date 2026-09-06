import {
  BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_RESULT_BYTES,
  bbDesktopBrowserJsonValueSchema,
  type BbDesktopBrowserJsonValue,
  type BbDesktopBrowserPageScriptRequest,
  type BbDesktopBrowserPageScriptResult,
} from "@bb/desktop-contract";

export const BB_BROWSER_PAGE_ISOLATED_WORLD_ID = 1_004;
const PAGE_RUNTIME_REGISTRY_KEY = "__bbBrowserPageRuntimeV1";
const COOPERATIVE_ABORT_GRACE_MS = 350;
const HEARTBEAT_RESPONSE_LIMIT_MS = 250;
const MAX_GRACE_PROBE_ATTEMPTS = 8;

interface PageRuntimeWebContents {
  debugger: {
    attach(protocolVersion?: string): void;
    detach(): void;
    isAttached(): boolean;
    sendCommand(
      method: string,
      params?: Record<string, unknown>,
      sessionId?: string,
    ): Promise<unknown>;
  };
  executeJavaScriptInIsolatedWorld(
    worldId: number,
    scripts: Array<{ code: string; url?: string }>,
    userGesture?: boolean,
  ): Promise<unknown>;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  isDestroyed(): boolean;
}

const pageExecutionOrder = new WeakMap<
  PageRuntimeWebContents,
  Map<string, Map<string, number>>
>();
let nextPageExecutionOrder = 0;

function markInvocationOutstanding(
  webContents: PageRuntimeWebContents,
  sessionId: string | undefined,
  requestId: string,
): void {
  const ordersByScope =
    pageExecutionOrder.get(webContents) ??
    new Map<string, Map<string, number>>();
  const scope = sessionId ?? "";
  const order = ordersByScope.get(scope) ?? new Map();
  order.set(requestId, nextPageExecutionOrder);
  nextPageExecutionOrder += 1;
  ordersByScope.set(scope, order);
  pageExecutionOrder.set(webContents, ordersByScope);
}

function clearInvocationOutstanding(
  webContents: PageRuntimeWebContents,
  sessionId: string | undefined,
  requestId: string,
): void {
  const ordersByScope = pageExecutionOrder.get(webContents);
  if (ordersByScope === undefined) return;
  const scope = sessionId ?? "";
  const order = ordersByScope.get(scope);
  if (order === undefined) return;
  order.delete(requestId);
  if (order.size === 0) ordersByScope.delete(scope);
  if (ordersByScope.size === 0) pageExecutionOrder.delete(webContents);
}

function hasNewerOutstandingInvocation(
  webContents: PageRuntimeWebContents,
  sessionId: string | undefined,
  requestId: string,
): boolean {
  const order = pageExecutionOrder.get(webContents)?.get(sessionId ?? "");
  if (order === undefined) return false;
  const own = order.get(requestId);
  return (
    own !== undefined &&
    [...order.values()].some((otherOrder) => otherOrder > own)
  );
}

function boundedHeartbeat(
  webContents: PageRuntimeWebContents,
  sessionId: string | undefined,
  requestId: string,
): Promise<boolean | null> {
  const heartbeat = webContents.debugger
    .sendCommand(
      "Runtime.evaluate",
      {
        expression: `globalThis[${JSON.stringify(PAGE_RUNTIME_REGISTRY_KEY)}]?.has(${JSON.stringify(requestId)}) === true`,
        returnByValue: true,
      },
      sessionId,
    )
    .then((raw) => {
      const result = raw as { result?: { value?: unknown } };
      return result?.result?.value === true;
    });
  return Promise.race([
    heartbeat,
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), HEARTBEAT_RESPONSE_LIMIT_MS),
    ),
  ]);
}

function probeExecutionStillAlive(
  webContents: PageRuntimeWebContents,
  sessionId: string | undefined,
  requestId: string,
  attemptsLeft: number,
): void {
  if (webContents.isDestroyed()) return;
  if (hasNewerOutstandingInvocation(webContents, sessionId, requestId)) return;
  if (attemptsLeft <= 0) {
    void terminateExecution(webContents, sessionId, requestId);
    return;
  }
  void boundedHeartbeat(webContents, sessionId, requestId).then((alive) => {
    if (webContents.isDestroyed()) return;
    if (alive === false) return;
    if (alive === null) {
      if (!hasNewerOutstandingInvocation(webContents, sessionId, requestId)) {
        void terminateExecution(webContents, sessionId, requestId);
      }
      return;
    }
    setTimeout(
      () =>
        probeExecutionStillAlive(
          webContents,
          sessionId,
          requestId,
          attemptsLeft - 1,
        ),
      COOPERATIVE_ABORT_GRACE_MS,
    );
  });
}

async function terminateExecution(
  webContents: PageRuntimeWebContents,
  sessionId: string | undefined,
  requestId: string,
): Promise<void> {
  let attachedHere = false;
  try {
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach("1.3");
      attachedHere = true;
    }
    await webContents.debugger.sendCommand(
      "Runtime.terminateExecution",
      {},
      sessionId,
    );
    await webContents.debugger.sendCommand(
      "Runtime.evaluate",
      {
        expression: `globalThis[${JSON.stringify(PAGE_RUNTIME_REGISTRY_KEY)}]?.delete(${JSON.stringify(requestId)});`,
        returnByValue: true,
      },
      sessionId,
    );
  } catch {
  } finally {
    if (attachedHere && webContents.debugger.isAttached()) {
      webContents.debugger.detach();
    }
  }
}

function armGraceKill(
  webContents: PageRuntimeWebContents,
  sessionId: string | undefined,
  requestId: string,
): void {
  setTimeout(
    () =>
      probeExecutionStillAlive(
        webContents,
        sessionId,
        requestId,
        MAX_GRACE_PROBE_ATTEMPTS,
      ),
    COOPERATIVE_ABORT_GRACE_MS,
  );
}

interface PageRuntimeEnvelope {
  ok: boolean;
  value?: unknown;
  error?: { code?: unknown; message?: unknown };
}

export interface DesktopBrowserPageScriptSession {
  readonly navigationEpoch: number;
  readonly requestId: string;
  readonly promise: Promise<BbDesktopBrowserPageScriptResult>;
  cancel(reason?: string): void;
}

export interface StartDesktopBrowserPageScriptArgs {
  navigationEpoch: number;
  request: BbDesktopBrowserPageScriptRequest;
  webContents: PageRuntimeWebContents;
  frameContext?: { uniqueContextId: string; sessionId: string };
}

function runtimeInvocationCode(
  request: BbDesktopBrowserPageScriptRequest,
  preCancelled: () => boolean,
): string {
  return `(async () => {
    const registryKey = ${JSON.stringify(PAGE_RUNTIME_REGISTRY_KEY)};
    const requestId = ${JSON.stringify(request.requestId)};
    const source = ${JSON.stringify(request.source)};
    const input = ${JSON.stringify(request.input)};
    const maxResultBytes = ${BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_RESULT_BYTES};
    const preCancelled = ${JSON.stringify(preCancelled())};
    const root = globalThis;
    const registry = root[registryKey] instanceof Map ? root[registryKey] : new Map();
    root[registryKey] = registry;
    registry.get(requestId)?.abort("replaced");
    const controller = new AbortController();
    registry.set(requestId, controller);
    if (preCancelled) controller.abort("cancelled");
    try {
      const run = (0, eval)("(" + source + ")");
      if (typeof run !== "function") throw new Error("Browser page script source must evaluate to a function");
      const value = await run(Object.freeze({ input, signal: controller.signal }));
      if (controller.signal.aborted) throw Object.assign(new Error("Browser page script was cancelled"), { code: "aborted" });
      const normalized = value === undefined ? null : value;
      const serializedValue = JSON.stringify(normalized);
      if (serializedValue === undefined) throw new Error("Browser page script returned a non-JSON value");
      if (new TextEncoder().encode(serializedValue).byteLength > maxResultBytes) {
        throw Object.assign(new Error("Browser page script result exceeds the byte limit"), { code: "result_too_large" });
      }
      return JSON.stringify({ ok: true, value: JSON.parse(serializedValue) });
    } catch (error) {
      const aborted = controller.signal.aborted;
      return JSON.stringify({
        ok: false,
        error: {
          code: aborted ? "aborted" : (typeof error?.code === "string" ? error.code : "script_failed"),
          message: aborted ? "Browser page script was cancelled" : String(error?.message ?? error ?? "Browser page script failed").slice(0, 1024)
        }
      });
    } finally {
      if (registry.get(requestId) === controller) registry.delete(requestId);
    }
  })()`;
}

function runtimeCancellationCode(requestId: string, reason: string): string {
  return `globalThis[${JSON.stringify(PAGE_RUNTIME_REGISTRY_KEY)}]?.get(${JSON.stringify(requestId)})?.abort(${JSON.stringify(reason)});`;
}

function safeErrorMessage(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, 1_024)
    : "Browser page script failed";
}

function parseEnvelope(value: unknown): PageRuntimeEnvelope {
  if (typeof value !== "string") {
    throw new Error("Browser page runtime returned an invalid envelope");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Browser page runtime returned invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Browser page runtime returned an invalid envelope");
  }
  const ok = Object.getOwnPropertyDescriptor(parsed, "ok")?.value;
  if (typeof ok !== "boolean") {
    throw new Error("Browser page runtime returned an invalid envelope");
  }
  const valueDescriptor = Object.getOwnPropertyDescriptor(parsed, "value");
  const errorValue = Object.getOwnPropertyDescriptor(parsed, "error")?.value;
  if (typeof errorValue !== "object" || errorValue === null) {
    return {
      ok,
      ...(valueDescriptor === undefined
        ? {}
        : { value: valueDescriptor.value }),
    };
  }
  const code = Object.getOwnPropertyDescriptor(errorValue, "code");
  const message = Object.getOwnPropertyDescriptor(errorValue, "message");
  return {
    ok,
    ...(valueDescriptor === undefined ? {} : { value: valueDescriptor.value }),
    error: {
      ...(code === undefined ? {} : { code: code.value }),
      ...(message === undefined ? {} : { message: message.value }),
    },
  };
}

function executePageCode(
  args: StartDesktopBrowserPageScriptArgs,
  code: string,
  url?: string,
): Promise<unknown> {
  if (args.frameContext === undefined) {
    return executeInRequestedWorld(
      args.webContents,
      args.request.world,
      code,
      url,
    );
  }
  return executeInFrame(args.webContents, args.frameContext, code);
}

function executeInRequestedWorld(
  webContents: PageRuntimeWebContents,
  world: "isolated" | "main" | undefined,
  code: string,
  url?: string,
): Promise<unknown> {
  return world === "main"
    ? webContents.executeJavaScript(code, true)
    : webContents.executeJavaScriptInIsolatedWorld(
        BB_BROWSER_PAGE_ISOLATED_WORLD_ID,
        [{ code, ...(url === undefined ? {} : { url }) }],
        true,
      );
}

function executeInFrame(
  webContents: PageRuntimeWebContents,
  selection: { uniqueContextId: string; sessionId: string },
  code: string,
): Promise<unknown> {
  return webContents.debugger
    .sendCommand(
      "Runtime.evaluate",
      {
        expression: code,
        uniqueContextId: selection.uniqueContextId,
        awaitPromise: true,
        returnByValue: true,
      },
      selection.sessionId || undefined,
    )
    .then((raw) => {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("Browser frame runtime returned an invalid result");
      }
      const resultValue = Object.getOwnPropertyDescriptor(raw, "result")?.value;
      if (
        typeof resultValue !== "object" ||
        resultValue === null ||
        Array.isArray(resultValue)
      ) {
        throw new Error("Browser frame runtime returned an invalid result");
      }
      if (Object.hasOwn(raw, "exceptionDetails")) {
        throw new Error("Browser frame runtime execution failed");
      }
      return Object.getOwnPropertyDescriptor(resultValue, "value")?.value;
    });
}

export function startDesktopBrowserPageScript(
  args: StartDesktopBrowserPageScriptArgs,
): DesktopBrowserPageScriptSession {
  const { request, webContents } = args;
  const sessionId = args.frameContext?.sessionId || undefined;
  let settled = false;
  let rejectPromise: ((error: Error) => void) | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let invocationSent = false;

  const cancelInPage = (reason: string): void => {
    if (webContents.isDestroyed()) return;
    void executePageCode(
      args,
      runtimeCancellationCode(request.requestId, reason),
    ).catch(() => undefined);
  };

  const promise = new Promise<BbDesktopBrowserPageScriptResult>(
    (resolve, reject) => {
      rejectPromise = reject;
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (timeout !== null) clearTimeout(timeout);
        if (invocationSent) {
          cancelInPage("timeout");
          armGraceKill(webContents, sessionId, request.requestId);
        }
        reject(new Error("Browser page script timed out"));
      }, request.timeoutMs);

      const invocation = executePageCode(
        args,
        runtimeInvocationCode(request, () => settled),
        `bb-browser-page-runtime://${encodeURIComponent(request.requestId)}`,
      );
      invocationSent = true;
      markInvocationOutstanding(webContents, sessionId, request.requestId);
      invocation
        .then((rawEnvelope) => {
          clearInvocationOutstanding(webContents, sessionId, request.requestId);
          if (settled) return;
          const envelope = parseEnvelope(rawEnvelope);
          if (!envelope.ok) {
            const error = new Error(safeErrorMessage(envelope.error?.message));
            error.name =
              envelope.error?.code === "aborted"
                ? "AbortError"
                : "BrowserPageScriptError";
            settled = true;
            if (timeout !== null) clearTimeout(timeout);
            reject(error);
            return;
          }
          const value = bbDesktopBrowserJsonValueSchema.parse(
            envelope.value ?? null,
          ) as BbDesktopBrowserJsonValue;
          if (settled) return;
          settled = true;
          if (timeout !== null) clearTimeout(timeout);
          resolve({
            requestId: request.requestId,
            navigationEpoch: args.navigationEpoch,
            ...(request.frame === undefined ? {} : { frame: request.frame }),
            value,
          });
        })
        .catch((error: unknown) => {
          clearInvocationOutstanding(webContents, sessionId, request.requestId);
          if (settled) return;
          settled = true;
          if (timeout !== null) clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    },
  );

  return {
    navigationEpoch: args.navigationEpoch,
    requestId: request.requestId,
    promise,
    cancel(reason = "cancelled") {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      cancelInPage(reason);
      armGraceKill(webContents, sessionId, request.requestId);
      const error = new Error(
        reason === "navigation"
          ? "Browser page changed while the script was running"
          : "Browser page script was cancelled",
      );
      error.name = reason === "navigation" ? "NavigationError" : "AbortError";
      rejectPromise?.(error);
    },
  };
}
