import { describe, expect, it } from "vitest";
import type { SenderThreadMetadata } from "@/hooks/useSenderThreadMetadataById";
import {
  isPluginSideChatSenderThread,
  SIDE_CHAT_PLUGIN_ID,
} from "./side-chat-plugin";

describe("isPluginSideChatSenderThread", () => {
  const pluginFork: SenderThreadMetadata = {
    projectId: "proj_test",
    title: null,
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
      isPluginSideChatSenderThread({ ...pluginFork, originKind: null }),
    ).toBe(false);
  });

  it("stops matching once the fork is promoted to visible", () => {
    expect(
      isPluginSideChatSenderThread({ ...pluginFork, visibility: "visible" }),
    ).toBe(false);
  });
});
