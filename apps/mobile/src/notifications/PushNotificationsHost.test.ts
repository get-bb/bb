import { beforeEach, describe, expect, it, vi } from "vitest";

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
  push: vi.fn(),
  responseListener: vi.fn<(response: NotificationResponse) => void>(),
  setNotificationHandler: vi.fn(),
}));

vi.mock("expo-notifications", () => ({
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
  const otherProfile = {
    ...profile,
    handle: "other",
    id: "profile-2",
    label: "Other",
    serverUrl: "https://other.example.test",
  };
  return {
    useProfiles: () => ({
      activeProfile: profile,
      connection: null,
      profiles: [profile, otherProfile],
      status: "ready",
    }),
    useAppRevealed: () => true,
    useRealtimeConnectionState: () => "disconnected",
  };
});

vi.mock("@/ui", () => ({
  ActionSheet: () => null,
  toast: { error: vi.fn(), message: vi.fn() },
  useSheet: () => ({ present: vi.fn() }),
}));

vi.mock("./AppBadgeSync", () => ({ AppBadgeSync: () => null }));
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
  getPushStore: () => ({
    getSnapshot: () => ({
      registrations: {
        "profile-1": { subscriptionId: "sub-1" },
        "profile-2": { subscriptionId: "sub-2" },
      },
    }),
    hasPrompted: vi.fn(() => true),
  }),
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
    PushNotificationsHost();
  });

  it("keeps foreground pushes silent while retaining them in the notification list", async () => {
    const handler = mocks.setNotificationHandler.mock.calls[0]?.[0];

    expect(handler).toBeDefined();
    await expect(handler.handleNotification()).resolves.toEqual({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
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

  it("switches to the server that sent a threadless push", async () => {
    mocks.responseListener(threadlessPush("https://other.example.test"));
    await vi.waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith({
        pathname: "/webview",
        params: { profileId: "profile-2" },
      }),
    );
  });

  it("switches to the server whose registration a threadless push names", async () => {
    mocks.responseListener({
      notification: {
        request: {
          content: { data: { kind: "message", subscriptionId: "sub-2" } },
        },
      },
    });
    await vi.waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith({
        pathname: "/webview",
        params: { profileId: "profile-2" },
      }),
    );
  });

  it("leaves the screen alone for a threadless push from the active server", async () => {
    mocks.responseListener(threadlessPush("https://bb.example.test"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

function threadlessPush(serverUrl: string): NotificationResponse {
  return {
    notification: {
      request: {
        content: { data: { kind: "message", serverUrl } },
      },
    },
  };
}
