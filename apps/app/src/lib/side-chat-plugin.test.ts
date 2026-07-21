import { describe, expect, it } from "vitest";
import type { SenderThreadMetadata } from "@/hooks/useSenderThreadMetadataById";
import {
  canStartNativeSideChat,
  isPluginSideChatSenderThread,
  SIDE_CHAT_PLUGIN_ID,
} from "./side-chat-plugin";

describe("canStartNativeSideChat", () => {
  it("goes inert while the sideChatPlugin experiment is on", () => {
    expect(
      canStartNativeSideChat({
        canSpawnChild: true,
        sideChatPluginEnabled: true,
      }),
    ).toBe(false);
  });

  it("preserves the spawn-depth policy while the experiment is off", () => {
    expect(
      canStartNativeSideChat({
        canSpawnChild: true,
        sideChatPluginEnabled: false,
      }),
    ).toBe(true);
    expect(
      canStartNativeSideChat({
        canSpawnChild: false,
        sideChatPluginEnabled: false,
      }),
    ).toBe(false);
  });
});

describe("isPluginSideChatSenderThread", () => {
  const pluginFork: SenderThreadMetadata = {
    title: null,
    childOrigin: null,
    originKind: "fork",
    originPluginId: SIDE_CHAT_PLUGIN_ID,
    visibility: "hidden",
  };

  it("matches this plugin's hidden forks only", () => {
    expect(isPluginSideChatSenderThread(pluginFork)).toBe(true);
    expect(isPluginSideChatSenderThread(null)).toBe(false);
    expect(
      isPluginSideChatSenderThread({ ...pluginFork, originPluginId: "other" }),
    ).toBe(false);
    expect(
      isPluginSideChatSenderThread({ ...pluginFork, originKind: "side-chat" }),
    ).toBe(false);
  });

  it("stops matching once the fork is promoted to visible", () => {
    expect(
      isPluginSideChatSenderThread({ ...pluginFork, visibility: "visible" }),
    ).toBe(false);
  });
});
