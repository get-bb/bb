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
  getLastNotificationResponse: vi.fn(() => null),
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

describe("PushNotificationsHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasThread.mockResolvedValue(false);
    mocks.toastMessage.mockImplementation((_, options) => options?.id?.toString() ?? "foreground-1");
    PushNotificationsHost();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
  ])("dismisses the opened %s notification after 500 ms", async (projectId, path) => {
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
      params: { path, profileId: "profile-1" },
    });
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.toastDismiss).toHaveBeenCalledExactlyOnceWith("foreground-1");
  });

  it("starts the dismissal delay after resolving the target profile", async () => {
    vi.useFakeTimers();
    let resolveProbe: (found: boolean) => void = () => {};
    mocks.hasThread.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      resolveProbe = resolve;
    }));
    receive({ threadId: "thr_1" }).onClick();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
    resolveProbe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.push).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(499);
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
    });
    mocks.hasThread.mockResolvedValue(true);
    action.onClick();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.toastDismiss).toHaveBeenCalledExactlyOnceWith("foreground-1");
  });

  it("ignores repeated Open taps while navigation and dismissal are pending", async () => {
    vi.useFakeTimers();
    const action = receive({ serverUrl: "https://bb.example.test", threadId: "thr_1" });
    action.onClick();
    action.onClick();
    await vi.advanceTimersByTimeAsync(250);
    action.onClick();
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.toastDismiss).toHaveBeenCalledExactlyOnceWith("foreground-1");
  });

  it("dismisses only the opened toast when another notification arrives", async () => {
    vi.useFakeTimers();
    receive({ serverUrl: "https://bb.example.test", threadId: "thr_1" }).onClick();
    await vi.advanceTimersByTimeAsync(250);
    receive({ serverUrl: "https://bb.example.test", threadId: "thr_2" }, "foreground-2");
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.toastDismiss).toHaveBeenCalledExactlyOnceWith("foreground-1");
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
  });
});
