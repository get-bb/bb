import {
  APP_SURFACE_WEB,
  type RequestAppSurface,
} from "@bb/config/app-surface";
import { registerSW } from "virtual:pwa-register";
import { appToast } from "@/components/ui/app-toast";
import { getAppSurface } from "./app-surface";

const PWA_UPDATE_TOAST_ID = "bb-pwa-update-ready";

interface PwaServiceWorkerContainer {
  readonly controller: object | null;
  addEventListener(type: "controllerchange", listener: EventListener): void;
  removeEventListener(type: "controllerchange", listener: EventListener): void;
}

interface PwaUpdateToastOptions {
  action: {
    label: string;
    onClick: () => void;
  };
  duration: number;
  id: string;
}

export interface PwaUpdateDependencies {
  appSurface: RequestAppSurface;
  isProduction: boolean;
  registerServiceWorker: (options: {
    onNeedReload: () => void;
    onNeedRefresh: () => void;
    onRegisterError: (error: unknown) => void;
  }) => () => Promise<void>;
  reload: () => void;
  reportError: (message: string, error: unknown) => void;
  serviceWorker: PwaServiceWorkerContainer | undefined;
  showToast: (title: string, options: PwaUpdateToastOptions) => string | number;
}

interface PendingUpdateActivationOptions {
  activateUpdate: () => Promise<void>;
  reload: () => void;
  reportError: (message: string, error: unknown) => void;
  serviceWorker: PwaServiceWorkerContainer;
}

function browserServiceWorker(): ServiceWorkerContainer | undefined {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return undefined;
  }
  return navigator.serviceWorker;
}

function browserDependencies(): PwaUpdateDependencies {
  return {
    appSurface: getAppSurface(),
    isProduction: import.meta.env.PROD,
    registerServiceWorker: registerSW,
    reload: () => window.location.reload(),
    reportError: (message, error) => console.error(message, error),
    serviceWorker: browserServiceWorker(),
    showToast: appToast.message,
  };
}

function createPendingUpdateActivation({
  activateUpdate,
  reload,
  reportError,
  serviceWorker,
}: PendingUpdateActivationOptions): () => void {
  let activationRequested = false;

  return () => {
    if (activationRequested) return;
    activationRequested = true;

    const previousController = serviceWorker.controller;
    const reloadWhenControlled: EventListener = () => {
      const nextController = serviceWorker.controller;
      if (nextController === null || nextController === previousController) {
        return;
      }
      serviceWorker.removeEventListener(
        "controllerchange",
        reloadWhenControlled,
      );
      reload();
    };
    serviceWorker.addEventListener("controllerchange", reloadWhenControlled);

    void activateUpdate().catch((error: unknown) => {
      serviceWorker.removeEventListener(
        "controllerchange",
        reloadWhenControlled,
      );
      activationRequested = false;
      reportError("Failed to activate the bb service worker update", error);
    });
  };
}

export function startPwaUpdateRegistration(
  dependencies: PwaUpdateDependencies = browserDependencies(),
): void {
  if (
    !dependencies.isProduction ||
    dependencies.appSurface !== APP_SURFACE_WEB ||
    dependencies.serviceWorker === undefined
  ) {
    return;
  }

  const serviceWorker = dependencies.serviceWorker;
  let reloadRequested = false;
  const reloadOnce = () => {
    if (reloadRequested) return;
    reloadRequested = true;
    dependencies.reload();
  };
  let pendingUpdateActivation: (() => void) | undefined;
  const activateUpdate = dependencies.registerServiceWorker({
    onNeedReload: reloadOnce,
    onNeedRefresh: () => {
      pendingUpdateActivation ??= createPendingUpdateActivation({
        activateUpdate,
        reload: reloadOnce,
        reportError: dependencies.reportError,
        serviceWorker,
      });
      dependencies.showToast("A bb update is ready", {
        action: {
          label: "Reload",
          onClick: pendingUpdateActivation,
        },
        duration: Infinity,
        id: PWA_UPDATE_TOAST_ID,
      });
    },
    onRegisterError: (error) => {
      dependencies.reportError(
        "Failed to register the bb service worker",
        error,
      );
    },
  });
}
