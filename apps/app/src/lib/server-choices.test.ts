// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { BbDesktopServerChoice } from "@bb/desktop-contract";
import { createBbDesktopApi } from "../test/bb-desktop-test-utils";
import { getServerChoices } from "./server-choices";
import { useServerChoices } from "../hooks/useServerChoices";

function createDesktopApi() {
  return createBbDesktopApi({
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: "test",
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "bbDesktop");
});

describe("desktop server choices", () => {
  it.each(["browser", "older-desktop"])("omits switching on %s", (client) => {
    if (client === "older-desktop") window.bbDesktop = createDesktopApi();
    expect(getServerChoices()).toBeNull();
  });

  it("keeps a newer subscription update when an older list response arrives", async () => {
    let resolveList: (choices: BbDesktopServerChoice[]) => void = () => {
      throw new Error("List was not requested");
    };
    const listeners = new Set<(choices: BbDesktopServerChoice[]) => void>();
    window.bbDesktop = {
      ...createDesktopApi(),
      getServerChoices: () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
      onServerChoicesChange: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      selectServer: () => {},
    };
    const { result } = renderHook(useServerChoices);
    const newer = [{ id: "new", name: "New server", active: true }];
    await act(async () => {
      for (const listener of listeners) listener(newer);
      resolveList([]);
    });
    expect(result.current.choices).toEqual(newer);
  });
});
