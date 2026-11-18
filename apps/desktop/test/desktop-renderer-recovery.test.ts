import { EventEmitter } from "node:events";
import type { RenderProcessGoneDetails } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CRASH_PAGE_RELOAD_URL,
  RENDERER_CRASH_WINDOW_MS,
  RENDERER_RELOAD_DELAYS_MS,
  watchRendererCrashes,
} from "../src/desktop-renderer-recovery.js";

const APP_URL = "http://127.0.0.1:19232/threads/thr_1";
const LOCAL_VIEW_PREFIX = "data:text/html;charset=utf-8,";

class FakeWebContents extends EventEmitter {
  public destroyed = false;
  public crashed = false;
  public url = APP_URL;
  public readonly loads: string[] = [];
  public reloads = 0;

  getURL(): string {
    return this.url;
  }

  isCrashed(): boolean {
    return this.crashed;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  async loadURL(url: string): Promise<void> {
    this.crashed = false;
    this.loads.push(url);
    this.url = url;
    this.emit("did-navigate");
  }

  reload(): void {
    this.crashed = false;
    this.reloads += 1;
    this.emit("did-navigate");
  }

  crash(reason: RenderProcessGoneDetails["reason"] = "oom"): void {
    this.crashed = true;
    this.emit("render-process-gone", {}, { exitCode: 9, reason });
  }

  clickLink(url: string): boolean {
    let prevented = false;
    this.emit("will-navigate", {
      preventDefault: () => {
        prevented = true;
      },
      url,
    });
    return prevented;
  }
}

function setup() {
  const webContents = new FakeWebContents();
  const logger = { error: vi.fn(), warn: vi.fn() };
  const onRendererGone = vi.fn();
  const recovery = watchRendererCrashes({
    describeWindow: () => 'window "bb"',
    logger,
    onRendererGone,
    webContents,
  });
  return { logger, onRendererGone, recovery, webContents };
}

function crashPageText(url: string | undefined): string {
  expect(url?.startsWith(LOCAL_VIEW_PREFIX)).toBe(true);
  return decodeURIComponent(url?.slice(LOCAL_VIEW_PREFIX.length) ?? "");
}

async function crashThroughAutomaticReloads(
  webContents: FakeWebContents,
): Promise<void> {
  for (const delay of RENDERER_RELOAD_DELAYS_MS) {
    webContents.crash();
    await vi.advanceTimersByTimeAsync(delay);
  }
  webContents.crash();
  await vi.advanceTimersByTimeAsync(0);
}

describe("watchRendererCrashes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs the reason and reloads the crashed page after a short delay", async () => {
    const { logger, onRendererGone, webContents } = setup();

    webContents.crash("oom");

    expect(onRendererGone).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      `[desktop] window "bb" renderer gone (reason oom, exit code 9) on http://127.0.0.1:19232/threads/thr_1; reloading in ${RENDERER_RELOAD_DELAYS_MS[0]} ms (attempt 1 of ${RENDERER_RELOAD_DELAYS_MS.length})`,
    );
    await vi.advanceTimersByTimeAsync(RENDERER_RELOAD_DELAYS_MS[0] - 1);
    expect(webContents.reloads).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(webContents.reloads).toBe(1);
  });

  it("backs off between repeated crashes, then shows a crash page instead of reloading forever", async () => {
    const { webContents } = setup();

    for (const [index, delay] of RENDERER_RELOAD_DELAYS_MS.entries()) {
      webContents.crash();
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(webContents.reloads).toBe(index);
      await vi.advanceTimersByTimeAsync(1);
      expect(webContents.reloads).toBe(index + 1);
    }
    webContents.crash();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(webContents.reloads).toBe(RENDERER_RELOAD_DELAYS_MS.length);
    const html = crashPageText(webContents.loads.at(-1));
    expect(html).toContain("This window stopped working");
    expect(html).toContain(
      `Its page ran out of memory again after bb reloaded it ${RENDERER_RELOAD_DELAYS_MS.length} times.`,
    );
    expect(html).toContain(
      `<a class="action" href="${CRASH_PAGE_RELOAD_URL}">Reload</a>`,
    );
  });

  it("forgets crashes older than the crash window", async () => {
    const { webContents } = setup();

    for (const delay of RENDERER_RELOAD_DELAYS_MS) {
      webContents.crash();
      await vi.advanceTimersByTimeAsync(delay);
    }
    await vi.advanceTimersByTimeAsync(RENDERER_CRASH_WINDOW_MS);
    webContents.crash();
    await vi.advanceTimersByTimeAsync(RENDERER_RELOAD_DELAYS_MS[0]);

    expect(webContents.loads).toEqual([]);
    expect(webContents.reloads).toBe(RENDERER_RELOAD_DELAYS_MS.length + 1);
  });

  it("shows the crash page at once when the renderer cannot start", async () => {
    const { webContents } = setup();

    webContents.crash("launch-failed");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(webContents.reloads).toBe(0);
    expect(crashPageText(webContents.loads.at(-1))).toContain(
      "Its page could not start.",
    );
  });

  it("restores the crashed page from the crash page's Reload link with a fresh retry budget", async () => {
    const { webContents } = setup();
    await crashThroughAutomaticReloads(webContents);

    expect(webContents.clickLink(CRASH_PAGE_RELOAD_URL)).toBe(true);

    expect(webContents.loads.at(-1)).toBe(APP_URL);
    webContents.crash();
    await vi.advanceTimersByTimeAsync(RENDERER_RELOAD_DELAYS_MS[0]);
    expect(webContents.reloads).toBe(RENDERER_RELOAD_DELAYS_MS.length + 1);
  });

  it("restores the crashed page when the window reload command runs on the crash page", async () => {
    const { recovery, webContents } = setup();

    expect(recovery.restoreCrashPage()).toBe(false);
    await crashThroughAutomaticReloads(webContents);

    expect(recovery.restoreCrashPage()).toBe(true);
    expect(webContents.loads.at(-1)).toBe(APP_URL);
    expect(recovery.restoreCrashPage()).toBe(false);
  });

  it("drops a pending reload when the window navigates elsewhere first", async () => {
    const { webContents } = setup();

    webContents.crash();
    await webContents.loadURL("http://127.0.0.1:19233/");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(webContents.reloads).toBe(0);
  });

  it("does not abort a main-process load that is still in flight when the backoff ends", async () => {
    const { webContents } = setup();

    webContents.crash();
    await vi.advanceTimersByTimeAsync(RENDERER_RELOAD_DELAYS_MS[0] - 50);
    webContents.crashed = false;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(webContents.reloads).toBe(0);
  });

  it("leaves the reload link alone when no crash page is showing", () => {
    const { webContents } = setup();

    expect(webContents.clickLink(CRASH_PAGE_RELOAD_URL)).toBe(false);
    expect(webContents.loads).toEqual([]);
  });

  it("does not reload a window that was destroyed during the backoff", async () => {
    const { webContents } = setup();

    webContents.crash();
    webContents.destroyed = true;
    webContents.emit("destroyed");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(webContents.reloads).toBe(0);
  });
});
