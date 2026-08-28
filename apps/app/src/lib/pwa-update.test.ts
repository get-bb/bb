import { describe, expect, it, vi } from "vitest";
import type { AppSurface } from "@bb/config/app-surface";
import {
  startPwaUpdateRegistration,
  type PwaUpdateDependencies,
} from "./pwa-update";

vi.mock("virtual:pwa-register", () => ({ registerSW: vi.fn() }));

interface RecordedToast {
  options: Parameters<PwaUpdateDependencies["showToast"]>[1];
  title: string;
}

class FakeServiceWorkerContainer extends EventTarget {
  controller: object | null = null;
}

function createHarness(
  overrides: Partial<
    Pick<PwaUpdateDependencies, "appSurface" | "isProduction" | "serviceWorker">
  > = {},
) {
  const serviceWorker = new FakeServiceWorkerContainer();
  const activateUpdate = vi.fn(async () => {});
  const reload = vi.fn();
  const reportError = vi.fn();
  const toasts: RecordedToast[] = [];
  let registrationOptions:
    | Parameters<PwaUpdateDependencies["registerServiceWorker"]>[0]
    | undefined;
  const registerServiceWorker = vi.fn(
    (
      options: Parameters<PwaUpdateDependencies["registerServiceWorker"]>[0],
    ) => {
      registrationOptions = options;
      return activateUpdate;
    },
  );
  const dependencies: PwaUpdateDependencies = {
    appSurface: "web",
    isProduction: true,
    registerServiceWorker,
    reload,
    reportError,
    serviceWorker,
    showToast: (title, options) => {
      toasts.push({ options, title });
      return options.id;
    },
    ...overrides,
  };

  return {
    activateUpdate,
    dependencies,
    getRegistrationOptions: () => registrationOptions,
    registerServiceWorker,
    reload,
    serviceWorker,
    toasts,
  };
}

describe("PWA update registration", () => {
  it.each<{
    appSurface: AppSurface;
    isProduction: boolean;
    serviceWorker: "available" | "missing";
    shouldRegister: boolean;
  }>([
    {
      appSurface: "web",
      isProduction: true,
      serviceWorker: "available",
      shouldRegister: true,
    },
    {
      appSurface: "web",
      isProduction: false,
      serviceWorker: "available",
      shouldRegister: false,
    },
    {
      appSurface: "desktop",
      isProduction: true,
      serviceWorker: "available",
      shouldRegister: false,
    },
    {
      appSurface: "web",
      isProduction: true,
      serviceWorker: "missing",
      shouldRegister: false,
    },
  ])(
    "registers=$shouldRegister for production=$isProduction surface=$appSurface serviceWorker=$serviceWorker",
    ({ appSurface, isProduction, serviceWorker, shouldRegister }) => {
      const harness = createHarness({ appSurface, isProduction });
      if (serviceWorker === "missing") {
        harness.dependencies.serviceWorker = undefined;
      }

      startPwaUpdateRegistration(harness.dependencies);

      expect(harness.registerServiceWorker).toHaveBeenCalledTimes(
        shouldRegister ? 1 : 0,
      );
    },
  );

  it("shows one persistent toast and waits for Reload", () => {
    const harness = createHarness();
    startPwaUpdateRegistration(harness.dependencies);
    const registrationOptions = harness.getRegistrationOptions();
    expect(registrationOptions).toBeDefined();

    registrationOptions?.onNeedRefresh();
    registrationOptions?.onNeedRefresh();

    expect(harness.activateUpdate).not.toHaveBeenCalled();
    expect(harness.toasts).toHaveLength(2);
    expect(harness.toasts[0]).toMatchObject({
      title: "A bb update is ready",
      options: {
        action: { label: "Reload" },
        duration: Infinity,
        id: "bb-pwa-update-ready",
      },
    });
    expect(harness.toasts[1]?.options.id).toBe(harness.toasts[0]?.options.id);
  });

  it("installs the controller listener before one activation request", () => {
    const operations: string[] = [];
    const harness = createHarness();
    harness.serviceWorker.addEventListener = (type, listener) => {
      operations.push("listen");
      EventTarget.prototype.addEventListener.call(
        harness.serviceWorker,
        type,
        listener,
      );
    };
    harness.dependencies.registerServiceWorker = (options) => {
      const activateUpdate = async () => {
        operations.push("activate");
      };
      harness.activateUpdate.mockImplementation(activateUpdate);
      const registeredActivateUpdate = harness.activateUpdate;
      harness.registerServiceWorker(options);
      return registeredActivateUpdate;
    };
    startPwaUpdateRegistration(harness.dependencies);
    harness.getRegistrationOptions()?.onNeedRefresh();
    const reloadAction = harness.toasts[0]?.options.action.onClick;

    reloadAction?.();
    reloadAction?.();

    expect(operations).toEqual(["listen", "activate"]);
    expect(harness.activateUpdate).toHaveBeenCalledOnce();
    expect(harness.activateUpdate).toHaveBeenCalledWith();
  });

  it("reloads after a new service worker controls the page", () => {
    const harness = createHarness();
    const previousController = {};
    harness.serviceWorker.controller = previousController;
    startPwaUpdateRegistration(harness.dependencies);
    harness.getRegistrationOptions()?.onNeedRefresh();
    harness.toasts[0]?.options.action.onClick();

    harness.serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(harness.reload).not.toHaveBeenCalled();

    harness.serviceWorker.controller = {};
    harness.serviceWorker.dispatchEvent(new Event("controllerchange"));
    harness.serviceWorker.dispatchEvent(new Event("controllerchange"));

    expect(harness.reload).toHaveBeenCalledOnce();
  });

  it("shares one reload latch with the plugin controller callback", () => {
    const harness = createHarness();
    startPwaUpdateRegistration(harness.dependencies);
    const registrationOptions = harness.getRegistrationOptions();
    registrationOptions?.onNeedRefresh();
    harness.toasts[0]?.options.action.onClick();

    harness.serviceWorker.controller = {};
    registrationOptions?.onNeedReload();
    harness.serviceWorker.dispatchEvent(new Event("controllerchange"));

    expect(harness.reload).toHaveBeenCalledOnce();
  });

  it("allows an activation retry after a rejected request", async () => {
    const harness = createHarness();
    harness.activateUpdate.mockRejectedValueOnce(new Error("activation failed"));
    startPwaUpdateRegistration(harness.dependencies);
    harness.getRegistrationOptions()?.onNeedRefresh();
    const reloadAction = harness.toasts[0]?.options.action.onClick;

    reloadAction?.();
    await vi.waitFor(() => {
      expect(harness.activateUpdate).toHaveBeenCalledOnce();
    });
    reloadAction?.();

    expect(harness.activateUpdate).toHaveBeenCalledTimes(2);
  });
});
