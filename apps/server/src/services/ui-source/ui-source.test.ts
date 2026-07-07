import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectRecoveryShim } from "./recovery-shim.js";
import {
  createUiSourceService,
  type UiSourceState,
} from "./ui-source.js";

describe("injectRecoveryShim", () => {
  class FakeElement {
    attrs: Record<string, string> = {};
    childElementCount = 0;
    children: FakeElement[] = [];
    disabled = false;
    id = "";
    onclick: (() => void) | null = null;
    parentNode: FakeElement | null = null;
    textContent = "";

    constructor(readonly tagName: string) {}

    appendChild(child: FakeElement): void {
      this.children.push(child);
      child.parentNode = this;
      this.childElementCount = this.children.length;
    }

    remove(): void {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter(
        (child) => child !== this,
      );
      this.parentNode.childElementCount = this.parentNode.children.length;
      this.parentNode = null;
    }

    setAttribute(name: string, value: string): void {
      this.attrs[name] = value;
    }
  }

  function findElement(root: FakeElement, id: string): FakeElement | null {
    if (root.id === id) return root;
    for (const child of root.children) {
      const found = findElement(child, id);
      if (found) return found;
    }
    return null;
  }

  function extractShimJs(html: string): string {
    const scriptStart = html.indexOf("<script");
    const jsStart = html.indexOf(">", scriptStart) + 1;
    const jsEnd = html.indexOf("</script>", jsStart);
    return html.slice(jsStart, jsEnd);
  }

  function runInjectedShim(html: string): {
    body: FakeElement;
    dispatchWindowEvent(type: string, event: { target?: FakeElement }): void;
    fetch: ReturnType<typeof vi.fn>;
    getElementById(id: string): FakeElement | null;
    mutationCallbacks: Array<() => void>;
    reload: ReturnType<typeof vi.fn>;
    root: FakeElement;
    runTimers(delayMs: number): void;
    webSockets: Array<{
      onclose: (() => void) | null;
      onmessage: ((event: { data: string }) => void) | null;
      onopen: (() => void) | null;
      send: () => void;
    }>;
  } {
    const root = new FakeElement("DIV");
    root.id = "root";
    const body = new FakeElement("BODY");
    const timers: Array<{ callback: () => void; delayMs: number }> = [];
    const mutationCallbacks: Array<() => void> = [];
    const windowListeners: Record<
      string,
      Array<(event: { target?: FakeElement }) => void>
    > = {};
    const fetch = vi.fn(() => Promise.resolve(new Response("{}")));
    const reload = vi.fn();
    const webSockets: Array<{
      onclose: (() => void) | null;
      onmessage: ((event: { data: string }) => void) | null;
      onopen: (() => void) | null;
      send: () => void;
    }> = [];
    const getElementById = (id: string): FakeElement | null => {
      if (id === "root") return root;
      return findElement(body, id);
    };
    const context = {
      document: {
        body,
        createElement: (tagName: string) => new FakeElement(tagName.toUpperCase()),
        getElementById,
        readyState: "interactive",
      },
      fetch,
      MutationObserver: class {
        constructor(callback: () => void) {
          mutationCallbacks.push(callback);
        }
        disconnect(): void {}
        observe(): void {}
      },
      setTimeout: (callback: () => void, delayMs: number) => {
        timers.push({ callback, delayMs });
        return timers.length;
      },
      WebSocket: class {
        onclose: (() => void) | null = null;
        onmessage: ((event: { data: string }) => void) | null = null;
        onopen: (() => void) | null = null;
        constructor() {
          webSockets.push(this);
        }
        send(): void {}
      },
      window: {
        addEventListener(
          type: string,
          listener: (event: { target?: FakeElement }) => void,
        ): void {
          windowListeners[type] ??= [];
          windowListeners[type].push(listener);
        },
        location: {
          host: "bb.example.test",
          protocol: "https:",
          reload,
        },
      },
    };
    runInNewContext(extractShimJs(html), context);
    return {
      body,
      dispatchWindowEvent(type: string, event: { target?: FakeElement }): void {
        for (const listener of windowListeners[type] ?? []) {
          listener(event);
        }
      },
      fetch,
      getElementById,
      mutationCallbacks,
      reload,
      root,
      runTimers(delayMs: number): void {
        for (const timer of timers.filter((timer) => timer.delayMs === delayMs)) {
          timer.callback();
        }
      },
      webSockets,
    };
  }

  it("inserts the shim before </head>", () => {
    const out = injectRecoveryShim("<html><head><title>x</title></head><body></body></html>");
    expect(out).toContain("data-bb-recovery-shim");
    expect(out).toContain('data-bb-ui-source-recovery="disabled"');
    expect(out).toContain("var RECOVERY_ENABLED = false;");
    expect(out.indexOf("data-bb-recovery-shim")).toBeLessThan(out.indexOf("</head>"));
  });

  it("can enable UI-source recovery for active fork HTML", () => {
    const out = injectRecoveryShim("<head></head>", { recoverEnabled: true });
    expect(out).toContain('data-bb-ui-source-recovery="enabled"');
    expect(out).toContain("var RECOVERY_ENABLED = true;");
  });

  it("keeps shipped/default recovery watchdog disabled", () => {
    const html = injectRecoveryShim("<head></head>");
    const shim = runInjectedShim(html);

    shim.runTimers(10_000);
    expect(shim.getElementById("bb-ui-recovery-bar")).toBeNull();

    shim.dispatchWindowEvent("error", { target: new FakeElement("SCRIPT") });
    shim.runTimers(3_000);

    expect(shim.getElementById("bb-ui-recovery-bar")).toBeNull();
    expect(shim.fetch).not.toHaveBeenCalled();
  });

  it("keeps live reload active for shipped and UI-source HTML", () => {
    for (const recoverEnabled of [false, true]) {
      const html = injectRecoveryShim("<head></head>", { recoverEnabled });
      const shim = runInjectedShim(html);

      shim.webSockets[0]?.onmessage?.({
        data: JSON.stringify({
          type: "changed",
          entity: "system",
          changes: ["ui-reloaded"],
        }),
      });

      expect(shim.reload).toHaveBeenCalledOnce();
    }
  });

  it("shows active-fork recovery manually without auto-reverting", async () => {
    const html = injectRecoveryShim("<head></head>", { recoverEnabled: true });
    const shim = runInjectedShim(html);

    shim.runTimers(10_000);

    const bar = shim.getElementById("bb-ui-recovery-bar");
    expect(bar).not.toBeNull();
    expect(shim.fetch).not.toHaveBeenCalled();

    const button = bar?.children.find((child) => child.tagName === "BUTTON");
    button?.onclick?.();
    expect(shim.fetch).toHaveBeenCalledWith("/api/v1/ui/prod", {
      method: "POST",
    });
    await Promise.resolve();
    expect(shim.reload).toHaveBeenCalledOnce();
  });

  it("shows manual recovery sooner after an active-fork script load failure", () => {
    const html = injectRecoveryShim("<head></head>", { recoverEnabled: true });
    const shim = runInjectedShim(html);
    const script = new FakeElement("SCRIPT");

    shim.dispatchWindowEvent("error", { target: script });
    shim.runTimers(3_000);

    expect(shim.getElementById("bb-ui-recovery-bar")).not.toBeNull();
    expect(shim.fetch).not.toHaveBeenCalled();
  });

  it("removes active-fork recovery if the app eventually mounts", () => {
    const html = injectRecoveryShim("<head></head>", { recoverEnabled: true });
    const shim = runInjectedShim(html);
    shim.runTimers(10_000);
    expect(shim.getElementById("bb-ui-recovery-bar")).not.toBeNull();

    shim.root.childElementCount = 1;
    for (const callback of shim.mutationCallbacks) {
      callback();
    }

    expect(shim.getElementById("bb-ui-recovery-bar")).toBeNull();
    expect(shim.fetch).not.toHaveBeenCalled();
  });

  it("is idempotent (does not double-inject)", () => {
    const once = injectRecoveryShim("<head></head>");
    const twice = injectRecoveryShim(once);
    expect(twice).toBe(once);
    expect(twice.match(/data-bb-recovery-shim/g)).toHaveLength(1);
  });

  it("prepends the shim when there is no head", () => {
    const out = injectRecoveryShim("<div id=\"root\"></div>");
    expect(out.startsWith("<script data-bb-recovery-shim")).toBe(true);
  });
});

describe("createUiSourceService", () => {
  const dirs: string[] = [];

  function makeDirs(): { dataDir: string; appDir: string } {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-ui-data-"));
    const appDir = mkdtempSync(join(tmpdir(), "bb-ui-app-"));
    dirs.push(dataDir, appDir);
    return { dataDir, appDir };
  }

  function makeService(args: {
    dataDir: string;
    appDir: string;
    hub?: { notifySystem: (changes: string[]) => void };
    isEnabled?: () => boolean;
  }) {
    const hub = args.hub ?? { notifySystem: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return createUiSourceService({
      dataDir: args.dataDir,
      appDir: args.appDir,
      hub: hub as never,
      logger,
      now: () => "2026-01-01T00:00:00.000Z",
      isEnabled: args.isEnabled,
    });
  }

  function writeState(dataDir: string, state: Partial<UiSourceState>): void {
    writeFileSync(join(dataDir, "ui-state.json"), JSON.stringify(state), "utf8");
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolveActiveRoot serves shipped by default", () => {
    const { dataDir, appDir } = makeDirs();
    const svc = makeService({ dataDir, appDir });
    expect(svc.resolveActiveRoot("/shipped")).toBe("/shipped");
  });

  it("resolveActiveRoot falls back to shipped when active=ui but no built dist", () => {
    const { dataDir, appDir } = makeDirs();
    writeState(dataDir, { active: "fork", status: "ready" });
    const svc = makeService({ dataDir, appDir });
    expect(svc.getState().active).toBe("fork");
    expect(svc.resolveActiveRoot("/shipped")).toBe("/shipped");
  });

  it("resolveActiveRoot serves the UI dist when active=ui and a build exists", () => {
    const { dataDir, appDir } = makeDirs();
    writeState(dataDir, { active: "fork", status: "ready" });
    const distDir = join(realpathSync(dataDir), "ui", "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "index.html"), "<html></html>", "utf8");
    const svc = makeService({ dataDir, appDir });
    expect(svc.resolveActiveRoot("/shipped")).toBe(distDir);
  });

  it("serves shipped (and reports disabled) when the experiment is off", () => {
    const { dataDir, appDir } = makeDirs();
    // A built fork that would otherwise be served.
    writeState(dataDir, { active: "fork", status: "ready" });
    const distDir = join(realpathSync(dataDir), "ui", "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "index.html"), "<html></html>", "utf8");
    const svc = makeService({ dataDir, appDir, isEnabled: () => false });
    expect(svc.isEnabled()).toBe(false);
    expect(svc.resolveActiveRoot("/shipped")).toBe("/shipped");
  });

  it("normalizes a persisted 'building' status left by a crash", () => {
    const { dataDir, appDir } = makeDirs();
    writeState(dataDir, { status: "building", lastBuiltAt: null });
    expect(makeService({ dataDir, appDir }).getState().status).toBe("idle");

    const second = makeDirs();
    writeState(second.dataDir, { status: "building", lastBuiltAt: "2026-01-01" });
    expect(makeService(second).getState().status).toBe("ready");
  });

  it("prod switches to the shipped UI and broadcasts a reload", async () => {
    const { dataDir, appDir } = makeDirs();
    writeState(dataDir, { active: "fork", status: "ready" });
    const hub = { notifySystem: vi.fn() };
    const svc = makeService({ dataDir, appDir, hub });
    await svc.prod();
    expect(svc.getState().active).toBe("prod");
    expect(hub.notifySystem).toHaveBeenCalledWith([
      "ui-reloaded",
      "ui-status-changed",
    ]);
  });
});

const SHIPPED_INDEX = [
  "<!doctype html>",
  "<html>",
  "  <head>",
  "    <title>SHIPPED</title>",
  "  </head>",
  '  <body><div id="root"></div></body>',
  "</html>",
  "",
].join("\n");

// Build flows that exercise the real git rebase logic, with the Vite build
// faked (buildRunner just writes the staged dist) so they are deterministic.
describe("createUiSourceService update flow", () => {
  const dirs: string[] = [];

  // A fake shipped app dir with the minimal files seed() copies + git-tracks.
  function makeAppDir(): string {
    const appDir = mkdtempSync(join(tmpdir(), "bb-ui-app-"));
    mkdirSync(join(appDir, "src"));
    writeFileSync(join(appDir, "src", "main.tsx"), "export const x = 1;\n");
    writeFileSync(join(appDir, "index.html"), SHIPPED_INDEX);
    mkdirSync(join(appDir, "node_modules"));
    dirs.push(appDir);
    return appDir;
  }

  function makeService(
    appDir: string,
    version = "1.0.0",
    ensureSource?: () => Promise<{ ok: boolean; log: string }>,
  ) {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-ui-data-"));
    dirs.push(dataDir);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const svc = createUiSourceService({
      dataDir,
      appDir,
      hub: { notifySystem: vi.fn() } as never,
      logger,
      version,
      ensureSource,
      now: () => "2026-01-01T00:00:00.000Z",
      // No real install/vendor in unit tests; the fake build needs no deps.
      prepareWorkspace: async () => ({ ok: true, log: "" }),
      buildRunner: async ({ stageDir }) => {
        mkdirSync(stageDir, { recursive: true });
        writeFileSync(join(stageDir, "index.html"), "<html>built</html>");
        return { ok: true, log: "" };
      },
    });
    return { svc, uiIndex: join(realpathSync(dataDir), "ui", "index.html") };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("update is a no-op when the shipped source is unchanged", async () => {
    const { svc } = makeService(makeAppDir());
    expect((await svc.fork()).ok).toBe(true);
    const result = await svc.update("start");
    expect(result.upToDate).toBe(true);
  });

  it("clean rebase preserves the user edit and merges the shipped change", async () => {
    const appDir = makeAppDir();
    const { svc, uiIndex } = makeService(appDir);
    expect((await svc.fork()).ok).toBe(true);
    // User edits the title line in their UI source.
    writeFileSync(uiIndex, readFileSync(uiIndex, "utf8").replace("SHIPPED", "USER"));
    // Shipped appends a trailing line (far from the title) — non-conflicting.
    writeFileSync(
      join(appDir, "index.html"),
      `${SHIPPED_INDEX}<!-- shipped marker -->\n`,
    );
    const result = await svc.update("start");
    expect(result.ok).toBe(true);
    expect(svc.getState().active).toBe("fork");
    const merged = readFileSync(uiIndex, "utf8");
    expect(merged).toContain("<title>USER</title>");
    expect(merged).toContain("<!-- shipped marker -->");
  });

  it("refreshes the packaged shipped source before updating", async () => {
    const appDir = makeAppDir();
    let ensureCalls = 0;
    const ensureSource = async (): Promise<{ ok: boolean; log: string }> => {
      ensureCalls += 1;
      if (ensureCalls === 2) {
        writeFileSync(
          join(appDir, "index.html"),
          `${SHIPPED_INDEX}<!-- refreshed source -->\n`,
        );
      }
      return { ok: true, log: "" };
    };
    const { svc, uiIndex } = makeService(appDir, "2.0.0", ensureSource);
    expect((await svc.fork()).ok).toBe(true);

    const result = await svc.update("start");

    expect(result.ok).toBe(true);
    expect(ensureCalls).toBe(2);
    expect(readFileSync(uiIndex, "utf8")).toContain(
      "<!-- refreshed source -->",
    );
  });

  it("conflicting change falls back to shipped with conflictFiles", async () => {
    const appDir = makeAppDir();
    const { svc, uiIndex } = makeService(appDir);
    expect((await svc.fork()).ok).toBe(true);
    writeFileSync(uiIndex, readFileSync(uiIndex, "utf8").replace("SHIPPED", "USER"));
    // Shipped changes the SAME title line — conflict.
    writeFileSync(
      join(appDir, "index.html"),
      SHIPPED_INDEX.replace("SHIPPED", "SHIPPEDV2"),
    );
    const result = await svc.update("start");
    expect(result.ok).toBe(false);
    expect(svc.getState().status).toBe("needs-rebase");
    expect(svc.getState().active).toBe("prod");
    expect(result.conflictFiles).toContain("index.html");
  });

  it("--continue completes after the conflict is resolved (no editor hang)", async () => {
    const appDir = makeAppDir();
    const { svc, uiIndex } = makeService(appDir);
    expect((await svc.fork()).ok).toBe(true);
    writeFileSync(uiIndex, readFileSync(uiIndex, "utf8").replace("SHIPPED", "USER"));
    writeFileSync(
      join(appDir, "index.html"),
      SHIPPED_INDEX.replace("SHIPPED", "SHIPPEDV2"),
    );
    expect((await svc.update("start")).ok).toBe(false);
    // Resolve the conflict by writing a clean file (no markers).
    writeFileSync(uiIndex, SHIPPED_INDEX.replace("SHIPPED", "RESOLVED"));
    const result = await svc.update("continue");
    expect(result.ok).toBe(true);
    expect(svc.getState().active).toBe("fork");
    expect(svc.getState().status).toBe("ready");
  });

  it("--abort restores the user's UI", async () => {
    const appDir = makeAppDir();
    const { svc, uiIndex } = makeService(appDir);
    expect((await svc.fork()).ok).toBe(true);
    writeFileSync(uiIndex, readFileSync(uiIndex, "utf8").replace("SHIPPED", "USER"));
    writeFileSync(
      join(appDir, "index.html"),
      SHIPPED_INDEX.replace("SHIPPED", "SHIPPEDV2"),
    );
    expect((await svc.update("start")).ok).toBe(false);
    const result = await svc.update("abort");
    expect(result.ok).toBe(true);
    expect(svc.getState().active).toBe("fork");
    expect(svc.getState().status).toBe("ready");
  });

  it("--abort with no update in progress reports cleanly", async () => {
    const { svc } = makeService(makeAppDir());
    expect((await svc.fork()).ok).toBe(true);
    const result = await svc.update("abort");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No UI update is in progress");
  });
});
