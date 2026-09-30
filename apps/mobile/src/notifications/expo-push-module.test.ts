import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  platform: { OS: "android" },
  channel: vi.fn(async () => undefined),
  permission: vi.fn(async () => ({ granted: true })),
  token: vi.fn(async () => ({ data: "ExponentPushToken[test]" })),
}));

vi.mock("react-native", () => ({ Platform: native.platform }));
vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
vi.mock("expo-notifications", () => ({
  AndroidImportance: { MAX: 5 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  setNotificationChannelAsync: native.channel,
  requestPermissionsAsync: native.permission,
  getExpoPushTokenAsync: native.token,
}));

import { createExpoPushModule } from "./expo-push-module";

beforeEach(() => {
  vi.clearAllMocks();
  native.platform.OS = "android";
});

describe("Android notification permission", () => {
  it("creates the channel before asking permission, even before a token exists", async () => {
    const notifications = createExpoPushModule();
    expect(await notifications.requestPermission()).toBe("granted");
    expect(native.channel.mock.invocationCallOrder[0]).toBeLessThan(
      native.permission.mock.invocationCallOrder[0]!,
    );
    expect(native.token).not.toHaveBeenCalled();
    expect(await notifications.getExpoPushToken("project")).toBe(
      "ExponentPushToken[test]",
    );
    expect(native.channel.mock.invocationCallOrder[1]).toBeLessThan(
      native.token.mock.invocationCallOrder[0]!,
    );
  });

  it("does not call the Android channel API on iOS", async () => {
    native.platform.OS = "ios";
    await createExpoPushModule().requestPermission();
    expect(native.channel).not.toHaveBeenCalled();
    expect(native.permission).toHaveBeenCalledOnce();
  });
});
