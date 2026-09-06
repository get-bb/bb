import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import type {
  ExperimentalBrowserControllerLifecycle,
  ExperimentalBrowserControllerProps,
} from "@get-bb/plugin-sdk";
import type { BrowserTabTarget, JsonValue } from "@bb/server-contract";
import {
  usePluginSlots,
  type PluginBrowserControllerSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  PluginSlotOwnershipContext,
  type PluginSlotOwnershipRegistry,
} from "./plugin-context";
import { captureBrowserPagePreview } from "@/lib/browser-capture-assembler";
import {
  browserControlClientIdentity,
  registerBrowserControllerRequestHandler,
  registerBrowserCapture,
  subscribeBrowserControllerDisposed,
  subscribeBrowserControllerReconnected,
  type BrowserControllerDisposeReason,
} from "@/lib/browser-control-client";

interface PluginBrowserControllersProps {
  desktopBrowser: BbDesktopBrowserApi;
  environmentId: string | null;
  threadId: string;
  projectId: string | null;
  tabId: string;
  navigationEpoch: number | null;
  url: string;
  isVisible: boolean;
  overlayRoot: HTMLElement | null;
  onOverlayLeaseChange(owner: symbol, open: boolean): void;
}

const { clientId: desktopClientId, windowId: desktopWindowId } =
  browserControlClientIdentity();

function BrowserControllerRuntime({
  slot,
  ...props
}: PluginBrowserControllersProps & { slot: PluginBrowserControllerSlot }) {
  const ownershipRegistry = useContext(PluginSlotOwnershipContext);
  const owner = useMemo(() => Symbol("browser-controller-runtime"), []);
  const registeredRef = useRef(false);
  const disposedRef = useRef(false);
  const disposeReasonRef = useRef<BrowserControllerDisposeReason | null>(null);
  const overlayOpenRef = useRef(false);
  const controllersRef = useRef(new Set<AbortController>());
  const lifecycleListenersRef = useRef(
    new Set<(event: ExperimentalBrowserControllerLifecycle) => void>(),
  );
  const requestHandlerRef = useRef<
    | ((request: {
        input: JsonValue;
        target: BrowserTabTarget;
        signal: AbortSignal;
      }) => Promise<JsonValue>)
    | null
  >(null);
  const [requestHandler, setRequestHandler] =
    useState<typeof requestHandlerRef.current>(null);
  const requestRegistrationRef = useRef<(() => void) | null>(null);
  const ready = props.navigationEpoch !== null;
  const [target, setTarget] = useState(() =>
    props.navigationEpoch === null
      ? null
      : {
          clientId: desktopClientId,
          windowId: desktopWindowId,
          tabId: props.tabId,
          navigationEpoch: props.navigationEpoch,
        },
  );
  const [visible, setVisible] = useState(props.isVisible);
  const [lifecycleController, setLifecycleController] = useState(
    () => new AbortController(),
  );
  const lifecycleControllerRef = useRef(lifecycleController);
  lifecycleControllerRef.current = lifecycleController;
  const targetRef = useRef<BrowserTabTarget | null>(null);
  targetRef.current = target;

  const releaseAll = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
    if (overlayOpenRef.current) {
      overlayOpenRef.current = false;
      props.onOverlayLeaseChange(owner, false);
    }
  }, [owner, props.onOverlayLeaseChange]);

  const emitLifecycle = useCallback(
    (event: ExperimentalBrowserControllerLifecycle) => {
      for (const listener of lifecycleListenersRef.current) {
        try {
          listener(event);
        } catch (error) {
          console.warn(`[plugin:${slot.pluginId}] Browser lifecycle listener failed`, error);
        }
      }
    },
    [slot.pluginId],
  );

  const dispose = useCallback(
    (reason: BrowserControllerDisposeReason) => {
      if (disposedRef.current) return;
      disposedRef.current = true;
      disposeReasonRef.current = reason;
      const currentTarget = targetRef.current;
      const cancellation = new DOMException(reason, "AbortError");
      lifecycleControllerRef.current.abort(cancellation);
      requestRegistrationRef.current?.();
      requestRegistrationRef.current = null;
      releaseAll();
      if (currentTarget !== null) {
        emitLifecycle({ kind: "disposed", target: currentTarget, reason });
      }
    },
    [emitLifecycle, releaseAll],
  );

  useEffect(() => {
    return subscribeBrowserControllerReconnected(() => {
      if (
        disposeReasonRef.current !== null &&
        disposeReasonRef.current !== "client-disconnected"
      ) {
        return;
      }
      disposedRef.current = false;
      disposeReasonRef.current = null;
      setLifecycleController(new AbortController());
    });
  }, []);

  useEffect(() => {
    const nextTarget =
      props.navigationEpoch === null
        ? null
        : {
            clientId: desktopClientId,
            windowId: desktopWindowId,
            tabId: props.tabId,
            navigationEpoch: props.navigationEpoch,
          };
    const current = targetRef.current;
    const changed =
      (current === null) !== (nextTarget === null) ||
      (current !== null &&
        nextTarget !== null &&
        (current.tabId !== nextTarget.tabId ||
          current.navigationEpoch !== nextTarget.navigationEpoch));
    if (changed) {
      lifecycleControllerRef.current.abort(new DOMException("navigation", "AbortError"));
      releaseAll();
      targetRef.current = nextTarget;
      if (!disposedRef.current) {
        const controller = new AbortController();
        lifecycleControllerRef.current = controller;
        setLifecycleController(controller);
      }
      if (current !== null && nextTarget !== null) {
        emitLifecycle({
          kind: "navigation",
          previousTarget: current,
          target: nextTarget,
          url: props.url,
        });
      }
    }
    targetRef.current = nextTarget;
    setTarget(nextTarget);
    setVisible(props.isVisible);
  }, [emitLifecycle, releaseAll, props.navigationEpoch, props.isVisible, props.tabId, props.url]);

  const registerRequestHandler = useCallback(
    (handler: NonNullable<typeof requestHandlerRef.current>) => {
      requestHandlerRef.current = handler;
      setRequestHandler(() => handler);
      return () => {
        if (requestHandlerRef.current !== handler) return;
        requestHandlerRef.current = null;
        setRequestHandler(null);
      };
    },
    [props.tabId, slot.id, slot.pluginId],
  );

  useEffect(() => {
    if (!ready || requestHandler === null || lifecycleController.signal.aborted)
      return;
    const unregister = registerBrowserControllerRequestHandler(
      slot.pluginId,
      slot.id,
      props.tabId,
      async (request) => {
        const signal = AbortSignal.any([
          request.signal,
          lifecycleController.signal,
        ]);
        signal.throwIfAborted();
        const result = await requestHandler({ ...request, signal });
        signal.throwIfAborted();
        return result;
      },
    );
    requestRegistrationRef.current = unregister;
    return () => {
      if (requestRegistrationRef.current === unregister)
        requestRegistrationRef.current = null;
      unregister();
    };
  }, [
    lifecycleController,
    ready,
    requestHandler,
    props.tabId,
    slot.id,
    slot.pluginId,
  ]);

  useEffect(() => {
    return subscribeBrowserControllerDisposed(
      props.tabId,
      props.threadId,
      props.environmentId,
      slot.pluginId,
      dispose,
    );
  }, [
    dispose,
    props.environmentId,
    props.tabId,
    props.threadId,
    slot.pluginId,
  ]);

  useEffect(() => {
    return () => {
      lifecycleControllerRef.current.abort();
      for (const controller of controllersRef.current) controller.abort();
      if (overlayOpenRef.current) {
        props.onOverlayLeaseChange(owner, false);
      }
    };
  }, [owner, props.onOverlayLeaseChange]);


  const ensureRegistered = useCallback(
    (registry: PluginSlotOwnershipRegistry | null) => {
      if (registry === null || registeredRef.current) return;
      registry.register(owner, releaseAll);
      registeredRef.current = true;
    },
    [owner, releaseAll],
  );

  useEffect(() => {
    ensureRegistered(ownershipRegistry);
    return () => {
      if (registeredRef.current) ownershipRegistry?.unregister(owner);
      registeredRef.current = false;
    };
  }, [ensureRegistered, owner, ownershipRegistry]);

  const controllerProps = useMemo<ExperimentalBrowserControllerProps>(
    () => ({
      target,
      environmentId: props.environmentId,
      threadId: props.threadId,
      projectId: props.projectId,
      url: props.url,
      isVisible: visible,
      experimental_browserControlAvailable:
        props.desktopBrowser.experimental_browserControlVersion === 2 &&
        props.desktopBrowser.experimental_runBrowserPageScript !== undefined &&
        props.desktopBrowser.experimental_captureBrowserPage !== undefined &&
        props.desktopBrowser.experimental_readBrowserCaptureChunk !== undefined &&
        props.desktopBrowser.experimental_releaseBrowserCapture !== undefined,
      experimental_lifecycleSignal: lifecycleController.signal,
      experimental_onLifecycle(listener) {
        lifecycleListenersRef.current.add(listener);
        return () => lifecycleListenersRef.current.delete(listener);
      },
      experimental_registerRequestHandler: registerRequestHandler,
      experimental_capturePage: async (options = {}) => {
        if (props.navigationEpoch === null) {
          throw new Error("Browser page navigation state is unavailable");
        }
        if (
          options.expectedNavigationEpoch !== undefined &&
          options.expectedNavigationEpoch !== props.navigationEpoch
        ) {
          throw new Error("Browser capture target is stale");
        }
        return captureBrowserPagePreview(props.desktopBrowser, {
          tabId: props.tabId,
          format: options.format ?? "png",
          quality: options.quality ?? 85,
          expectedNavigationEpoch: props.navigationEpoch,
          signal:
            options.signal === undefined
              ? lifecycleController.signal
              : AbortSignal.any([lifecycleController.signal, options.signal]),
        });
      },
      experimental_createImageResource: (input, options = {}) => {
        if (target === null) {
          return Promise.reject(
            new Error("Browser image resource target is unavailable"),
          );
        }
        return registerBrowserCapture(input.blob, {
          target,
          ...(input.pixelSize === undefined
            ? {}
            : { pixelSize: input.pixelSize }),
          signal:
            options.signal === undefined
              ? lifecycleController.signal
              : AbortSignal.any([lifecycleController.signal, options.signal]),
        });
      },
      experimental_runBrowserPageScript: async (request, runOptions) => {
        const run = props.desktopBrowser.experimental_runBrowserPageScript;
        if (
          props.desktopBrowser.experimental_browserControlVersion !== 2 ||
          run === undefined
        ) {
          throw new Error(
            "Browser page scripts require a newer BB desktop app",
          );
        }
        if (props.navigationEpoch === null) {
          throw new Error("Browser page navigation state is unavailable");
        }
        if (
          request.expectedNavigationEpoch !== undefined &&
          request.expectedNavigationEpoch !== props.navigationEpoch
        ) {
          throw new Error("Browser script target is stale");
        }
        const controller = new AbortController();
        const signal = AbortSignal.any([
          lifecycleController.signal,
          runOptions.signal,
        ]);
        const onAbort = (): void => controller.abort();
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
        const unlink = () => signal.removeEventListener("abort", onAbort);
        controllersRef.current.add(controller);
        try {
          return await run(
            {
              tabId: props.tabId,
              requestId: request.requestId ?? crypto.randomUUID(),
              expectedNavigationEpoch:
                request.expectedNavigationEpoch ?? props.navigationEpoch,
              world: request.world ?? "isolated",
              ...(request.frame === undefined ? {} : { frame: request.frame }),
              source: request.source,
              input: request.input ?? null,
              timeoutMs: request.timeoutMs ?? 30_000,
            },
            { signal: controller.signal },
          );
        } finally {
          unlink();
          controllersRef.current.delete(controller);
        }
      },
      experimental_setOverlayOpen(open) {
        if (open && (disposedRef.current || lifecycleController.signal.aborted ||
          target === null || targetRef.current?.tabId !== target.tabId ||
          targetRef.current.navigationEpoch !== target.navigationEpoch)) {
          throw new Error("Browser controller is no longer available");
        }
        if (!open && overlayOpenRef.current === false) return;
        ensureRegistered(ownershipRegistry);
        if (overlayOpenRef.current === open) return;
        overlayOpenRef.current = open;
        props.onOverlayLeaseChange(owner, open);
      },
      experimental_overlayRoot: props.overlayRoot,
    }),
    [
      ensureRegistered,
      lifecycleController,
      owner,
      ownershipRegistry,
      props.desktopBrowser,
      props.environmentId,
      props.navigationEpoch,
      props.onOverlayLeaseChange,
      props.overlayRoot,
      props.projectId,
      props.tabId,
      props.threadId,
      props.url,
      registerRequestHandler,
      target,
      visible,
    ],
  );
  const Component = slot.component;
  return <Component {...controllerProps} />;
}

export function PluginBrowserControllers(props: PluginBrowserControllersProps) {
  const { browserControllers } = usePluginSlots();
  if (browserControllers.length === 0) return null;
  return (
    <>
      {browserControllers.map((slot) => (
        <PluginSlotMount
          key={`${slot.pluginId}/${slot.id}/${slot.generation}/${props.tabId}`}
          pluginId={slot.pluginId}
          slotKind="browserController"
          slotId={slot.id}
          instanceId={props.tabId}
          crashFallback={null}
        >
          <BrowserControllerRuntime slot={slot} {...props} />
        </PluginSlotMount>
      ))}
    </>
  );
}
