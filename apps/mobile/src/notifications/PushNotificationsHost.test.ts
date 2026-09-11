import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToastOptions } from "@/ui/Toast";

interface NotificationResponse {
  notification: {
    request: {
      content: {
        data: Record<string, string>;
      };
    };
  };
}

const mocks = vi.hoisted(() => ({
  addTokenListener: vi.fn(() => () => undefined),
  clearLastNotificationResponse: vi.fn(),
  getLastNotificationResponse: vi.fn<() => NotificationResponse | null>(() => null),
  hasThread: vi.fn(async () => false),
  push: vi.fn(),
  receivedListener: vi.fn(),
  responseListener: vi.fn<(response: NotificationResponse) => void>(),
  setNotificationHandler: vi.fn(),
  toastDismiss: vi.fn(),
  toastError: vi.fn(),
  toastMessage: vi.fn<(message: string, options?: ToastOptions) => string>(),
}));

vi.mock("expo-notifications", () => ({
  addNotificationReceivedListener: vi.fn((listener) => {
    mocks.receivedListener.mockImplementation(listener);
    return { remove: vi.fn() };
  }),
  addNotificationResponseReceivedListener: vi.fn((listener) => {
    mocks.responseListener.mockImplementation(listener);
    return { remove: vi.fn() };
  }),
  clearLastNotificationResponse: mocks.clearLastNotificationResponse,
  getLastNotificationResponse: mocks.getLastNotificationResponse,
  setNotificationHandler: mocks.setNotificationHandler,
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void | (() => void)) => effect(),
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => ({ current }),
  };
});

vi.mock("react-native", () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

vi.mock("@/app-shell", () => {
  const profile = {
    credential: "credential",
    handle: "profile",
    id: "profile-1",
    label: "Profile",
    mode: "connect",
    serverUrl: "https://bb.example.test",
  };
  return {
    useProfiles: () => ({
      activeProfile: profile,
      connection: null,
      profiles: [profile],
      status: "ready",
    }),
    useRealtimeConnectionState: () => "disconnected",
  };
});

vi.mock("@/ui", () => ({
  ActionSheet: () => null,
  toast: {
    dismiss: mocks.toastDismiss,
    error: mocks.toastError,
    message: mocks.toastMessage,
  },
  useSheet: () => ({ present: vi.fn() }),
}));

vi.mock("./AppBadgeSync", () => ({ AppBadgeSync: () => null }));
vi.mock("./thread-probe", () => ({ hasThreadOnServer: mocks.hasThread }));
vi.mock("./expo-push-module", () => ({
  getPushNotificationsModule: () => ({
    addTokenListener: mocks.addTokenListener,
    getPermission: vi.fn(async () => "denied"),
    projectId: null,
  }),
}));
vi.mock("./push-controller", () => ({
  getPushRegistrationController: () => ({
    handleTokenRolled: vi.fn(),
    reconcileRemovedProfiles: vi.fn(async () => undefined),
    refreshPermission: vi.fn(async () => "denied"),
    setEnabled: vi.fn(),
    sync: vi.fn(),
  }),
}));
vi.mock("./push-storage", () => ({
  getPushStore: () => ({ hasPrompted: vi.fn(() => true) }),
}));
vi.mock("./use-push-store", () => ({
  usePushStoreSnapshot: () => ({
    enabledProfileIds: [],
    prompted: true,
  }),
}));

import { PushNotificationsHost } from "./PushNotificationsHost";
import {
  finishNotificationNavigation,
  setNotificationNavigationReady,
} from "./notification-navigation";

describe("PushNotificationsHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasThread.mockResolvedValue(false);
    mocks.toastMessage.mockImplementation(
      (_, options) => options?.id?.toString() ?? "foreground-1",
    );
    PushNotificationsHost();
  });

  afterEach(() => {
    finishNotificationNavigation(navigationId(), "cancelled");
    finishNotificationNavigation("foreground-2:1", "cancelled");
    vi.useRealTimers();
  });

  function navigationId(): string {
    return mocks.push.mock.calls.at(-1)?.[0]?.params.notificationId ?? "foreground-1:1";
  }

  function receive(data: Record<string, string>, id = "foreground-1") {
    mocks.toastMessage.mockReturnValueOnce(id);
    mocks.receivedListener({
      request: {
        identifier: id,
        content: {
          title: "Thread finished",
          body: "The notification fix is ready to review.",
          data: { kind: "turn-finished", ...data },
        },
      },
    });
    const action = mocks.toastMessage.mock.calls.at(-1)?.[1]?.action;
    if (!action) throw new Error("Missing foreground notification Open action");
    expect(action.label).toBe("Open");
    return action;
  }

  it.each([
    ["proj_1", "/projects/proj_1/threads/thr_1"],
    [null, "/threads/thr_1"],
  ])("dismisses the opened %s notification after 100 ms", async (projectId, path) => {
    vi.useFakeTimers();
    const action = receive({
      ...(projectId ? { projectId } : {}),
      serverUrl: "https://bb.example.test",
      threadId: "thr_1",
    });
    action.onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.push).toHaveBeenCalledWith({
      pathname: "/webview",
      params: { path, profileId: "profile-1", notificationId: "foreground-1:1" },
    });
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    setNotificationNavigationReady(navigationId(), true);
    await vi.advanceTimersByTimeAsync(99);
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.toastDismiss).toHaveBeenCalledExactlyOnceWith("foreground-1");
  });

  it("waits for the thread page after a slow profile lookup", async () => {
    vi.useFakeTimers();
    let resolveProbe: (found: boolean) => void = () => {};
    mocks.hasThread.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => {
        resolveProbe = resolve;
      }),
    );
    receive({ threadId: "thr_1" }).onClick();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    expect(mocks.toastMessage.mock.calls.at(-1)?.[1]).toMatchObject({
      id: "foreground-1",
      duration: Infinity,
    });
    resolveProbe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.push).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    setNotificationNavigationReady(navigationId(), true);
    await vi.advanceTimersByTimeAsync(99);
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.toastDismiss).toHaveBeenCalledExactlyOnceWith("foreground-1");
  });

  it("keeps an unresolved notification and allows retrying Open", async () => {
    vi.useFakeTimers();
    const action = receive({ threadId: "thr_1" });
    action.onClick();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("Could not open the thread", {
      description: "None of your saved servers has it.",
      duration: 2_000,
      overlay: true,
    });
    mocks.hasThread.mockResolvedValue(true);
    action.onClick();
    await vi.advanceTimersByTimeAsync(0);
    setNotificationNavigationReady(navigationId(), true);
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.toastDismiss).toHaveBeenCalledExactlyOnceWith("foreground-1");
  });

  it("refreshes the original toast for retry after a late failed Open", async () => {
    vi.useFakeTimers();
    const action = receive({ threadId: "thr_1" });
    await vi.advanceTimersByTimeAsync(7_500);
    action.onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.toastMessage.mock.calls.at(-1)?.[1]).toMatchObject({
      id: "foreground-1",
      duration: 8_000,
      action,
    });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    mocks.hasThread.mockResolvedValue(true);
    action.onClick();
    await vi.advanceTimersByTimeAsync(0);
    setNotificationNavigationReady(navigationId(), true);
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.toastDismiss).toHaveBeenCalledExactlyOnceWith("foreground-1");
  });

  it("ignores repeated Open taps while navigation and dismissal are pending", async () => {
    vi.useFakeTimers();
    const action = receive({
      serverUrl: "https://bb.example.test",
      threadId: "thr_1",
    });
    action.onClick();
    action.onClick();
    await vi.advanceTimersByTimeAsync(0);
    setNotificationNavigationReady(navigationId(), true);
    await vi.advanceTimersByTimeAsync(50);
    action.onClick();
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.toastDismiss).toHaveBeenCalledExactlyOnceWith("foreground-1");
  });

  it("dismisses only the opened toast when another notification arrives", async () => {
    vi.useFakeTimers();
    receive({ serverUrl: "https://bb.example.test", threadId: "thr_1" }).onClick();
    await vi.advanceTimersByTimeAsync(0);
    setNotificationNavigationReady(navigationId(), true);
    await vi.advanceTimersByTimeAsync(50);
    receive(
      { serverUrl: "https://bb.example.test", threadId: "thr_2" },
      "foreground-2",
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.toastDismiss).toHaveBeenCalledExactlyOnceWith("foreground-1");
  });

  it("keeps the toast through loading and ignores another page's readiness", async () => {
    vi.useFakeTimers();
    receive({ serverUrl: "https://bb.example.test", threadId: "thr_1" }).onClick();
    await vi.advanceTimersByTimeAsync(0);
    setNotificationNavigationReady("another-navigation", true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    setNotificationNavigationReady(navigationId(), true);
    await vi.advanceTimersByTimeAsync(50);
    setNotificationNavigationReady(navigationId(), false);
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    setNotificationNavigationReady(navigationId(), true);
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.toastDismiss).toHaveBeenCalledExactlyOnceWith("foreground-1");
  });

  it("cancels dismissal and restores Open when navigation fails or the user leaves", async () => {
    vi.useFakeTimers();
    const action = receive({ serverUrl: "https://bb.example.test", threadId: "thr_1" });
    action.onClick();
    await vi.advanceTimersByTimeAsync(0);
    setNotificationNavigationReady(navigationId(), true);
    await vi.advanceTimersByTimeAsync(50);
    finishNotificationNavigation(navigationId(), "cancelled");
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    expect(mocks.toastMessage.mock.calls.at(-1)?.[1]).toMatchObject({ duration: 8_000, action });
    action.onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.push).toHaveBeenCalledTimes(2);
    setNotificationNavigationReady(navigationId(), true);
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.toastDismiss).toHaveBeenCalledExactlyOnceWith("foreground-1");
  });

  it("leaves an unopened notification on its existing eight-second lifetime", async () => {
    vi.useFakeTimers();
    receive({ threadId: "thr_1" });
    expect(mocks.toastMessage.mock.calls[0]?.[1]?.duration).toBe(8_000);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
  });

  it("does not restore a toast the user dismissed while the page was loading", async () => {
    vi.useFakeTimers();
    receive({ serverUrl: "https://bb.example.test", threadId: "thr_1" }).onClick();
    await vi.advanceTimersByTimeAsync(0);
    mocks.toastMessage.mock.calls.at(-1)?.[1]?.onDismiss?.();
    const shown = mocks.toastMessage.mock.calls.length;
    finishNotificationNavigation(navigationId(), "cancelled");
    setNotificationNavigationReady(navigationId(), true);
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.toastMessage).toHaveBeenCalledTimes(shown);
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
  });

  it("ignores a notification without a valid thread target", () => {
    mocks.receivedListener({ request: { content: { data: {} } } });
    expect(mocks.toastMessage).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps a notification available when the server probe rejects", async () => {
    vi.useFakeTimers();
    mocks.hasThread.mockRejectedValueOnce(new Error("Server disconnected"));
    receive({ threadId: "thr_1" }).onClick();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledOnce();
  });

  it("opens a cold-start response without applying a foreground toast delay", async () => {
    vi.useFakeTimers();
    mocks.getLastNotificationResponse.mockReturnValueOnce({
      notification: {
        request: {
          content: {
            data: { serverUrl: "https://bb.example.test", threadId: "thr_1" },
          },
        },
      },
    });
    PushNotificationsHost();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.clearLastNotificationResponse).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith({
      pathname: "/webview",
      params: { path: "/threads/thr_1", profileId: "profile-1" },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.toastMessage).not.toHaveBeenCalled();
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
  });

  it("opens a project thread from a push response with its project route", async () => {
    mocks.responseListener({
      notification: {
        request: {
          content: {
            data: {
              projectId: "proj_1",
              serverUrl: "https://bb.example.test",
              threadId: "thr_1",
            },
          },
        },
      },
    });
    await vi.waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith({
        pathname: "/webview",
        params: {
          path: "/projects/proj_1/threads/thr_1",
          profileId: "profile-1",
        },
      }),
    );
    expect(mocks.toastMessage).not.toHaveBeenCalled();
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
  });
});
