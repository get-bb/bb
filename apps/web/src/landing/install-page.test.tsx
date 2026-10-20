// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InstallPage } from "./install-page";
import type { DesktopPlatform } from "./site";

describe("installation page", () => {
  let root: Root | null;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    history.replaceState(null, "", "/install/macos");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove();
    history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  async function mount(platform: DesktopPlatform = "macos") {
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <StrictMode>
          <InstallPage platform={platform} />
        </StrictMode>,
      );
    });
  }

  async function unmount() {
    await act(async () => root?.unmount());
    root = null;
  }

  it.each<DesktopPlatform>(["macos", "windows", "linux"])(
    "offers a raw %s installer and other platforms without JavaScript",
    (platform) => {
      container.innerHTML = renderToStaticMarkup(
        <InstallPage platform={platform} />,
      );
      const retry = container.querySelector<HTMLAnchorElement>("a[download]");
      expect(retry?.getAttribute("href")).toBe(`/install/${platform}/file`);
      expect(container.querySelectorAll("ol > li")).toHaveLength(3);
      const alternatives = Array.from(
        container.querySelectorAll<HTMLAnchorElement>(
          ".install-alternatives a",
        ),
        (link) => new URL(link.href),
      );
      expect(alternatives).toHaveLength(2);
      for (const alternative of alternatives) {
        expect(alternative.pathname).not.toBe(`/download/${platform}`);
        expect(alternative.pathname).toMatch(
          /^\/download\/(macos|windows|linux)$/,
        );
        expect(alternative.searchParams.get("instructions")).toBe("1");
      }
      expect(history.state).toBeNull();
    },
  );

  it("marks the entry before requesting its installer and preserves router state", async () => {
    const routerState = {
      __TSR_key: "entry-one",
      __TSR_index: 4,
      scroll: { y: 20 },
    };
    history.replaceState(routerState, "", "/install/macos?utm_source=docs");
    const statesAtClick: unknown[] = [];
    const downloads: string[] = [];
    container.addEventListener("click", (event) => {
      if (!(event.target instanceof HTMLAnchorElement)) return;
      event.preventDefault();
      statesAtClick.push(history.state);
      downloads.push(event.target.pathname);
    });
    const historyLength = history.length;

    await mount();
    expect(downloads).toEqual(["/install/macos/file"]);
    expect(statesAtClick[0]).toMatchObject(routerState);
    expect(statesAtClick[0]).not.toEqual(routerState);
    expect(history.length).toBe(historyLength);
    expect(location.search).toBe("?utm_source=docs");

    await unmount();
    await mount();
    expect(downloads).toHaveLength(1);

    container.querySelector<HTMLAnchorElement>("a[download]")?.click();
    expect(downloads).toEqual(["/install/macos/file", "/install/macos/file"]);
  });

  it("starts a new entry but does not restart when returning through history", async () => {
    history.replaceState(
      { __TSR_key: "origin" },
      "",
      "/compare/cursor-alternative",
    );
    history.pushState({ __TSR_key: "first" }, "", "/install/macos");
    let requests = 0;
    container.addEventListener("click", (event) => {
      event.preventDefault();
      requests += 1;
    });
    await mount();
    expect(requests).toBe(1);
    await unmount();

    const back = new Promise<void>((resolve) => {
      window.addEventListener("popstate", () => resolve(), { once: true });
    });
    history.back();
    await back;
    expect(location.pathname).toBe("/compare/cursor-alternative");

    const forward = new Promise<void>((resolve) => {
      window.addEventListener("popstate", () => resolve(), { once: true });
    });
    history.forward();
    await forward;
    await mount();
    expect(requests).toBe(1);
    await unmount();

    history.pushState({ __TSR_key: "second" }, "", "/install/macos");
    await mount();
    expect(requests).toBe(2);
  });
});
