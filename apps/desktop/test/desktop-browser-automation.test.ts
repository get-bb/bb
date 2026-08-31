import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES,
  type BrowserAutomationCommand,
} from "@bb/domain";
import {
  DesktopBrowserAutomationDriver,
  type AutomationWebContents,
} from "../src/desktop-browser-automation.js";

type DebuggerParameter = string | number | boolean | readonly { objectId: string }[];

interface DebuggerCall {
  method: string;
  params: Record<string, DebuggerParameter> | undefined;
}

class FakeDebugger {
  public attached = false;
  public readonly calls: DebuggerCall[] = [];
  public response: (
    method: string,
    params?: Record<string, DebuggerParameter>,
  ) => unknown = () => ({});

  attach(): void {
    this.attached = true;
  }

  detach(): void {
    this.attached = false;
  }

  isAttached(): boolean {
    return this.attached;
  }

  async sendCommand(
    method: string,
    params?: Record<string, DebuggerParameter>,
  ): Promise<unknown> {
    this.calls.push({ method, params });
    return this.response(method, params);
  }
}

class FakeWebContents implements AutomationWebContents {
  public readonly debugger = new FakeDebugger();
  public destroyed = false;
  public loading = false;
  public stopCalls = 0;
  public url = "https://example.test/";

  getURL(): string {
    return this.url;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isLoadingMainFrame(): boolean {
    return this.loading;
  }

  stop(): void {
    this.stopCalls += 1;
    this.loading = false;
  }
}

function axTree(name = "Saved") {
  return {
    nodes: [
      {
        nodeId: "root",
        ignored: false,
        role: { value: "document" },
        name: { value: "Page" },
        childIds: ["button"],
      },
      {
        nodeId: "button",
        backendDOMNodeId: 17,
        ignored: false,
        role: { value: "button" },
        name: { value: name },
        value: { value: "current" },
        properties: [
          { name: "checked", value: { type: "booleanOrUndefined" } },
          { name: "disabled", value: { value: false } },
          { name: "url", value: { value: "https://example.test/action" } },
        ],
      },
    ],
  };
}

function configurePage(webContents: FakeWebContents, name = "Saved"): void {
  let selectedOption = false;
  webContents.debugger.response = (method, params) => {
    if (method === "Accessibility.getFullAXTree") return axTree(name);
    if (method === "Accessibility.getPartialAXTree") {
      const backendNodeId = Number(params?.backendNodeId);
      return {
        nodes: [{
          backendDOMNodeId: backendNodeId,
          ignored: false,
          nodeId: `ax-${backendNodeId}`,
          properties: backendNodeId === 102
            ? [{ name: "selected", value: { value: selectedOption } }]
            : [{ name: "disabled", value: { value: false } }],
        }],
      };
    }
    if (method === "DOM.getBoxModel") {
      return { model: { content: [10, 20, 30, 20, 30, 50, 10, 50] } };
    }
    if (method === "DOM.getNodeForLocation") return { backendNodeId: 17 };
    if (method === "Page.captureScreenshot") return { data: "aGVsbG8=" };
    if (method === "Page.getLayoutMetrics") {
      return {
        cssLayoutViewport: { clientHeight: 800, clientWidth: 1200, pageX: 0, pageY: 0 },
        cssVisualViewport: { pageX: 0, pageY: 0 },
      };
    }
    if (method === "DOM.describeNode") {
      return {
        node: {
          nodeName: "SELECT",
          children: [
            {
              backendNodeId: 101,
              nodeName: "OPTION",
              attributes: ["value", "viewer"],
              children: [{ nodeName: "#text", nodeValue: "Viewer" }],
            },
            {
              backendNodeId: 102,
              nodeName: "OPTION",
              attributes: ["value", "Admin"],
              children: [{ nodeName: "#text", nodeValue: "Administrator" }],
            },
          ],
        },
      };
    }
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main-frame" } } };
    if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
    if (method === "DOM.resolveNode") return { object: { objectId: params?.backendNodeId === 102 ? "option-object" : "select-object" } };
    if (method === "Runtime.callFunctionOn") selectedOption = true;
    return {};
  };
}

function register(
  driver: DesktopBrowserAutomationDriver,
  webContents: FakeWebContents,
  targetId = "bt_1",
  hostWebContentsId = 10,
  activate: () => void = () => {},
): void {
  driver.register({
    activate,
    hostWebContentsId,
    tabId: "browser:agent",
    targetId,
    webContents,
  });
}

function methods(webContents: FakeWebContents): string[] {
  return webContents.debugger.calls.map((call) => call.method);
}

describe("DesktopBrowserAutomationDriver", () => {
  it("registers one exact target per native tab and cleans up debugger ownership", () => {
    const driver = new DesktopBrowserAutomationDriver();
    const first = new FakeWebContents();
    const second = new FakeWebContents();

    register(driver, first);
    expect(first.debugger.attached).toBe(true);
    expect(() => register(driver, second)).toThrow("already registered");
    expect(() => register(driver, first, "bt_2")).toThrow("already owned");

    driver.unregister("bt_1", 99);
    expect(first.debugger.attached).toBe(true);
    driver.unregister("bt_1", 10);
    expect(first.debugger.attached).toBe(false);

    register(driver, second, "bt_2");
    driver.destroy();
    expect(second.debugger.attached).toBe(false);
  });

  it("builds bounded AX snapshots with native refs, state, and correct bounds", async () => {
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    configurePage(webContents);
    register(driver, webContents);

    await expect(
      driver.run("bt_1", { kind: "snapshot" }, 10, 0),
    ).resolves.toEqual({
      kind: "snapshot",
      generation: 1,
      navigationEpoch: 0,
      ready: true,
      url: "https://example.test/",
      nodes: [
        {
          children: [
            {
              bounds: { x: 10, y: 20, width: 20, height: 30 },
              children: [],
              disabled: false,
              href: "https://example.test/action",
              name: "Saved",
              ref: "e0g1r1",
              role: "button",
              value: "current",
              visible: true,
            },
          ],
          name: "Page",
          role: "document",
          visible: false,
        },
      ],
    });
    expect(methods(webContents)).toEqual([
      "Accessibility.getFullAXTree",
      "Page.getLayoutMetrics",
      "DOM.getBoxModel",
    ]);
  });

  it("uses only scoped CDP commands for every action and preserves page state", async () => {
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    const activate = vi.fn();
    configurePage(webContents);
    register(driver, webContents, "bt_1", 10, activate);
    const snapshot = await driver.run("bt_1", { kind: "snapshot" }, 10, 0);
    if (snapshot.kind !== "snapshot") throw new Error("expected snapshot");
    const ref = snapshot.nodes[0]?.children[0]?.ref;
    if (ref === undefined) throw new Error("expected native ref");

    const baseResponse = webContents.debugger.response;
    webContents.debugger.response = (method, params) => {
      if (method === "Page.navigate") {
        webContents.url = String(params?.url);
        driver.didStartNavigation(webContents);
        driver.didNavigate(webContents);
      }
      return baseResponse(method, params);
    };
    const commands: BrowserAutomationCommand[] = [
      { kind: "click", ref, snapshotGeneration: snapshot.generation },
      {
        kind: "type",
        ref,
        snapshotGeneration: snapshot.generation,
        text: "hello",
      },
      { kind: "press", key: "Enter" },
      {
        kind: "select",
        ref,
        snapshotGeneration: snapshot.generation,
        value: "Admin",
      },
      { kind: "screenshot" },
      { kind: "wait", text: "Saved" },
      { kind: "navigate", url: "https://example.test/next" },
    ];
    for (const command of commands) {
      const expectedEpoch = command.kind === "navigate" ? 1 : 0;
      await expect(driver.run("bt_1", command, 10, 0, 1_000)).resolves.toMatchObject({
        navigationEpoch: expectedEpoch,
        ready: true,
      });
    }

    expect(activate).toHaveBeenCalledTimes(4);
    expect(methods(webContents)).toEqual(expect.arrayContaining([
      "Input.dispatchMouseEvent",
      "DOM.focus",
      "Input.insertText",
      "Input.dispatchKeyEvent",
      "Page.captureScreenshot",
      "Accessibility.getFullAXTree",
      "Page.navigate",
    ]));
    expect(methods(webContents)).not.toContain("Runtime.evaluate");
    expect(webContents.debugger.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: "Input.dispatchMouseEvent",
        params: expect.objectContaining({ type: "mouseMoved", buttons: 0 }),
      }),
      expect.objectContaining({
        method: "Input.dispatchMouseEvent",
        params: expect.objectContaining({ type: "mousePressed", buttons: 1 }),
      }),
      expect.objectContaining({
        method: "Input.dispatchMouseEvent",
        params: expect.objectContaining({ type: "mouseReleased", buttons: 0 }),
      }),
    ]));
  });

  it("rejects occluded click targets while allowing bounded nested hit targets", async () => {
    vi.useFakeTimers();
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    configurePage(webContents);
    register(driver, webContents);
    const snapshot = await driver.run("bt_1", { kind: "snapshot" }, 10, 0);
    if (snapshot.kind !== "snapshot") throw new Error("expected snapshot");
    const ref = snapshot.nodes[0]?.children[0]?.ref ?? "missing";
    const baseResponse = webContents.debugger.response;
    webContents.debugger.response = (method, params) => {
      if (method === "DOM.getNodeForLocation") return { backendNodeId: 18 };
      if (method === "DOM.describeNode") {
        return Number(params?.backendNodeId) === 18
          ? { node: { backendNodeId: 18, nodeName: "SPAN", children: [] } }
          : {
              node: {
                backendNodeId: 17,
                nodeName: "BUTTON",
                children: [{ backendNodeId: 18, nodeName: "SPAN", children: [] }],
              },
            };
      }
      return baseResponse(method, params);
    };
    const nested = driver.run("bt_1", {
      kind: "click",
      ref,
      snapshotGeneration: snapshot.generation,
    }, 10, 0, 1_000);
    await vi.advanceTimersByTimeAsync(500);
    await expect(nested).resolves.toMatchObject({ kind: "state" });

    webContents.debugger.response = (method, params) => {
      if (method === "DOM.getNodeForLocation") return { backendNodeId: 99 };
      if (method === "DOM.describeNode") {
        return Number(params?.backendNodeId) === 99
          ? { node: { backendNodeId: 99, nodeName: "DIV", children: [] } }
          : { node: { backendNodeId: 17, nodeName: "BUTTON", children: [] } };
      }
      return baseResponse(method, params);
    };
    const mouseCallsBefore = webContents.debugger.calls.filter((call) => call.method === "Input.dispatchMouseEvent").length;
    await expect(driver.run("bt_1", {
      kind: "click",
      ref,
      snapshotGeneration: snapshot.generation,
    }, 10, 0, 1_000)).rejects.toThrow("occluded or another element intercepts pointer input");
    expect(webContents.debugger.calls.filter((call) => call.method === "Input.dispatchMouseEvent")).toHaveLength(mouseCallsBefore);
    vi.useRealTimers();
  });

  it("dispatches bounded native key descriptors with default-action text semantics", async () => {
    vi.useFakeTimers();
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    configurePage(webContents);
    register(driver, webContents);
    for (const key of ["Enter", "Tab", "Escape", "Space", "PageDown", "PageUp", "ArrowDown", "Backspace", "a", "?"] as const) {
      const pressing = driver.run("bt_1", { kind: "press", key }, 10, 0, 1_000);
      await vi.advanceTimersByTimeAsync(500);
      await pressing;
    }
    const keyDowns = webContents.debugger.calls.filter(
      (call) => call.method === "Input.dispatchKeyEvent" && call.params?.type === "keyDown",
    );
    expect(keyDowns).toEqual(expect.arrayContaining([
      expect.objectContaining({ params: expect.objectContaining({ key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" }) }),
      expect.objectContaining({ params: expect.objectContaining({ key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }) }),
      expect.objectContaining({ params: expect.objectContaining({ key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " }) }),
      expect.objectContaining({ params: expect.objectContaining({ key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 }) }),
      expect.objectContaining({ params: expect.objectContaining({ key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }) }),
      expect.objectContaining({ params: expect.objectContaining({ key: "a", code: "KeyA", windowsVirtualKeyCode: 65, text: "a" }) }),
      expect.objectContaining({ params: expect.objectContaining({ key: "?", code: "Slash", windowsVirtualKeyCode: 191, text: "?" }) }),
    ]));
    expect(keyDowns).toHaveLength(10);
    vi.useRealTimers();
  });

  it("returns action-initiated navigation state after the native page settles", async () => {
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    configurePage(webContents);
    register(driver, webContents);
    const snapshot = await driver.run("bt_1", { kind: "snapshot" }, 10, 0);
    if (snapshot.kind !== "snapshot") throw new Error("expected snapshot");
    const ref = snapshot.nodes[0]?.children[0]?.ref ?? "missing";
    const baseResponse = webContents.debugger.response;
    webContents.debugger.response = (method, params) => {
      if (
        method === "Input.dispatchMouseEvent" &&
        params?.type === "mouseReleased"
      ) {
        setTimeout(() => {
          webContents.loading = true;
          driver.didStartNavigation(webContents);
          setTimeout(() => {
            webContents.url = "https://example.test/after-click";
            webContents.loading = false;
            driver.didNavigate(webContents);
          }, 250);
        }, 200);
      }
      return baseResponse(method);
    };

    await expect(driver.run("bt_1", {
      kind: "click",
      ref,
      snapshotGeneration: snapshot.generation,
    }, 10, 0)).resolves.toMatchObject({
      kind: "state",
      navigationEpoch: 1,
      ready: true,
      url: "https://example.test/after-click",
    });
  });

  it("settles a non-navigating action after the causality window instead of its deadline", async () => {
    vi.useFakeTimers();
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    configurePage(webContents);
    register(driver, webContents);

    const pressing = driver.run("bt_1", { kind: "press", key: "Tab" }, 10, 0, 10_000);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pressing).resolves.toMatchObject({
      navigationEpoch: 0,
      ready: true,
    });
    vi.useRealTimers();
  });

  it("publishes snapshots atomically when navigation races bounds collection", async () => {
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    configurePage(webContents);
    register(driver, webContents);
    let releaseBounds: (value: unknown) => void = () => {};
    const baseResponse = webContents.debugger.response;
    webContents.debugger.response = (method, params) => {
      if (method === "DOM.getBoxModel") {
        return new Promise((resolve) => {
          releaseBounds = resolve;
        });
      }
      return baseResponse(method, params);
    };

    const snapshot = driver.run("bt_1", { kind: "snapshot" }, 10, 0);
    await vi.waitFor(() => expect(methods(webContents)).toContain("DOM.getBoxModel"));
    webContents.url = "https://example.test/new";
    driver.didNavigate(webContents);
    releaseBounds({ model: { content: [10, 20, 30, 20, 30, 50, 10, 50] } });
    await expect(snapshot).rejects.toThrow("stale during collection");

    configurePage(webContents);
    await expect(driver.run("bt_1", { kind: "snapshot" }, 10, 1)).resolves.toMatchObject({
      generation: 2,
      navigationEpoch: 1,
      url: "https://example.test/new",
    });
  });

  it("uses one fixed isolated-world operation on exact resolved nodes and verifies its AX postcondition", async () => {
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    configurePage(webContents);
    register(driver, webContents);
    const snapshot = await driver.run("bt_1", { kind: "snapshot" }, 10, 0);
    if (snapshot.kind !== "snapshot") throw new Error("expected snapshot");
    const ref = snapshot.nodes[0]?.children[0]?.ref ?? "missing";

    await driver.run("bt_1", {
      kind: "select",
      ref,
      snapshotGeneration: snapshot.generation,
      value: "Admin",
    }, 10, 0, 1_000);

    const runtimeCalls = webContents.debugger.calls.filter((call) => call.method === "Runtime.callFunctionOn");
    expect(runtimeCalls).toHaveLength(1);
    expect(runtimeCalls[0]?.params).toMatchObject({
      arguments: [{ objectId: "option-object" }],
      awaitPromise: false,
      objectId: "select-object",
      returnByValue: false,
    });
    expect(runtimeCalls[0]?.params?.functionDeclaration).toContain("option.selected = true");
    expect(runtimeCalls[0]?.params?.functionDeclaration).not.toContain("Admin");
    expect(webContents.debugger.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "Page.createIsolatedWorld", params: expect.objectContaining({ grantUniveralAccess: false, worldName: "bb-exact-native-select" }) }),
      expect.objectContaining({ method: "Accessibility.getPartialAXTree", params: expect.objectContaining({ backendNodeId: 102, fetchRelatives: false }) }),
      expect.objectContaining({ method: "Runtime.releaseObject", params: { objectId: "option-object" } }),
      expect.objectContaining({ method: "Runtime.releaseObject", params: { objectId: "select-object" } }),
    ]));
    expect(methods(webContents)).not.toContain("Runtime.evaluate");
  });

  it("rejects non-select, missing, duplicate, disabled, multiple, and listbox select targets", async () => {
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    configurePage(webContents);
    register(driver, webContents);
    const snapshot = await driver.run("bt_1", { kind: "snapshot" }, 10, 0);
    if (snapshot.kind !== "snapshot") throw new Error("expected snapshot");
    const ref = snapshot.nodes[0]?.children[0]?.ref ?? "missing";
    const baseResponse = webContents.debugger.response;
    const select = (node: object, value = "Admin") => {
      webContents.debugger.response = (method, params) => method === "DOM.describeNode" ? { node } : baseResponse(method, params);
      return driver.run("bt_1", { kind: "select", ref, snapshotGeneration: snapshot.generation, value }, 10, 0);
    };

    await expect(select({ nodeName: "BUTTON", children: [] })).rejects.toThrow("not a native select");
    await expect(select({ nodeName: "SELECT", children: [] })).rejects.toThrow("not found");
    await expect(select({
      nodeName: "SELECT",
      children: [
        { backendNodeId: 201, nodeName: "OPTION", attributes: ["value", "Admin"], children: [] },
        { backendNodeId: 202, nodeName: "OPTION", attributes: ["value", "Admin"], children: [] },
      ],
    })).rejects.toThrow("ambiguous");
    await expect(select({
      nodeName: "SELECT",
      children: [{ backendNodeId: 201, nodeName: "OPTION", attributes: ["value", "Admin", "disabled", ""], children: [] }],
    })).rejects.toThrow("value is disabled");
    await expect(select({ nodeName: "SELECT", attributes: ["disabled", ""], children: [] })).rejects.toThrow("select is disabled");
    await expect(select({ nodeName: "SELECT", attributes: ["multiple", ""], children: [] })).rejects.toThrow("multiple values");
    await expect(select({ nodeName: "SELECT", attributes: ["size", "2"], children: [] })).rejects.toThrow("size is not supported");
    expect(methods(webContents)).not.toContain("Runtime.callFunctionOn");
  });

  it("passes only the validated option object to fixed code and rejects a failed exact postcondition", async () => {
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    configurePage(webContents);
    register(driver, webContents);
    const snapshot = await driver.run("bt_1", { kind: "snapshot" }, 10, 0);
    if (snapshot.kind !== "snapshot") throw new Error("expected snapshot");
    const ref = snapshot.nodes[0]?.children[0]?.ref ?? "missing";
    const injectedValue = `x\"); globalThis.compromised = true; ("`;
    const baseResponse = webContents.debugger.response;
    webContents.debugger.response = (method, params) => {
      if (method === "DOM.describeNode") return {
        node: {
          nodeName: "SELECT",
          children: [{ backendNodeId: 102, nodeName: "OPTION", attributes: ["value", injectedValue], children: [] }],
        },
      };
      return baseResponse(method, params);
    };
    await driver.run("bt_1", { kind: "select", ref, snapshotGeneration: snapshot.generation, value: injectedValue }, 10, 0, 1_000);
    const runtime = webContents.debugger.calls.find((call) => call.method === "Runtime.callFunctionOn");
    expect(runtime?.params?.arguments).toEqual([{ objectId: "option-object" }]);
    expect(runtime?.params?.functionDeclaration).not.toContain(injectedValue);

    webContents.debugger.response = (method, params) => {
      if (method === "Accessibility.getPartialAXTree" && params?.backendNodeId === 102) {
        return { nodes: [{ backendDOMNodeId: 102, ignored: false, nodeId: "option", properties: [{ name: "selected", value: { value: false } }] }] };
      }
      return baseResponse(method, params);
    };
    await expect(driver.run("bt_1", { kind: "select", ref, snapshotGeneration: snapshot.generation, value: "Admin" }, 10, 0, 1_000)).rejects.toThrow("exact-value postcondition failed");
  });

  it("rejects stale window, navigation, and snapshot generations", async () => {
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    configurePage(webContents);
    register(driver, webContents);
    const snapshot = await driver.run("bt_1", { kind: "snapshot" }, 10, 0);
    if (snapshot.kind !== "snapshot") throw new Error("expected snapshot");
    const ref = snapshot.nodes[0]?.children[0]?.ref ?? "missing";

    await expect(driver.run("bt_1", { kind: "press", key: "Enter" }, 11, 0)).rejects.toThrow("not found");
    driver.didNavigate(webContents);
    await expect(driver.run("bt_1", { kind: "wait", text: "Saved" }, 10, 0)).resolves.toMatchObject({
      kind: "snapshot",
      navigationEpoch: 1,
    });
    await expect(driver.run("bt_1", { kind: "snapshot" }, 10, 0)).resolves.toMatchObject({
      kind: "snapshot",
      navigationEpoch: 1,
    });
    await expect(driver.run("bt_1", { kind: "screenshot" }, 10, 0)).resolves.toMatchObject({
      kind: "screenshot",
      navigationEpoch: 1,
    });
    await expect(driver.run("bt_1", { kind: "press", key: "Enter" }, 10, 0)).rejects.toThrow("revision is stale");
    await expect(driver.run("bt_1", { kind: "wait", text: "Saved" }, 10, 2)).rejects.toThrow("revision is stale");
    await expect(driver.run("bt_1", {
      kind: "click",
      ref,
      snapshotGeneration: snapshot.generation,
    }, 10, 1)).rejects.toThrow("generation is stale");

    webContents.url = "https://example.test/next";
    await expect(driver.run("bt_1", { kind: "press", key: "Enter" }, 10, 1)).resolves.toMatchObject({
      navigationEpoch: 1,
      url: "https://example.test/next",
    });
  });

  it("enforces one in-flight command and cancellation without closing the page", async () => {
    vi.useFakeTimers();
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    configurePage(webContents, "Not yet");
    register(driver, webContents);

    const waiting = driver.run("bt_1", { kind: "wait", text: "name" }, 10, 0, 10_000);
    await Promise.resolve();
    await expect(driver.run("bt_1", { kind: "snapshot" }, 10, 0)).rejects.toThrow("busy");
    driver.cancel("bt_1", 99);
    expect(webContents.stopCalls).toBe(0);
    driver.cancel("bt_1", 10);
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(webContents.stopCalls).toBe(0);
    expect(webContents.destroyed).toBe(false);
    vi.useRealTimers();
  });

  it("cancels select validation before the fixed operation executes and releases ownership", async () => {
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    configurePage(webContents);
    register(driver, webContents);
    const snapshot = await driver.run("bt_1", { kind: "snapshot" }, 10, 0);
    if (snapshot.kind !== "snapshot") throw new Error("expected snapshot");
    const ref = snapshot.nodes[0]?.children[0]?.ref ?? "missing";
    const baseResponse = webContents.debugger.response;
    webContents.debugger.response = (method, params) => {
      if (method === "Accessibility.getPartialAXTree") return new Promise(() => {});
      return baseResponse(method, params);
    };

    const selecting = driver.run("bt_1", {
      kind: "select",
      ref,
      snapshotGeneration: snapshot.generation,
      value: "Admin",
    }, 10, 0, 10_000);
    await vi.waitFor(() => expect(methods(webContents)).toContain("Accessibility.getPartialAXTree"));
    driver.cancel("bt_1", 10);
    await expect(selecting).rejects.toMatchObject({ name: "AbortError" });
    expect(methods(webContents)).not.toContain("Runtime.callFunctionOn");

    configurePage(webContents);
    await expect(driver.run("bt_1", { kind: "snapshot" }, 10, 0)).resolves.toMatchObject({ kind: "snapshot" });
  });

  it("preserves authoritative navigation state after cancelling navigate and click", async () => {
    const driver = new DesktopBrowserAutomationDriver();
    const navigateContents = new FakeWebContents();
    navigateContents.debugger.response = (method) => {
      if (method === "Page.navigate") {
        navigateContents.loading = true;
        navigateContents.url = "https://example.test/committed";
        driver.didStartNavigation(navigateContents);
        driver.didNavigate(navigateContents);
      }
      return {};
    };
    register(driver, navigateContents);
    const navigating = driver.run("bt_1", {
      kind: "navigate",
      url: "https://example.test/committed",
    }, 10, 0, 10_000);
    await vi.waitFor(() => expect(driver.getPageState("bt_1", 10)?.navigationEpoch).toBe(1));
    driver.cancel("bt_1", 10);
    await expect(navigating).rejects.toMatchObject({ name: "AbortError" });
    expect(driver.getPageState("bt_1", 10)).toMatchObject({
      navigationEpoch: 1,
      url: "https://example.test/committed",
    });
    configurePage(navigateContents);
    await expect(driver.run("bt_1", { kind: "snapshot" }, 10, 1)).resolves.toMatchObject({ navigationEpoch: 1 });

    const clickContents = new FakeWebContents();
    configurePage(clickContents);
    register(driver, clickContents, "bt_2");
    const snapshot = await driver.run("bt_2", { kind: "snapshot" }, 10, 0);
    if (snapshot.kind !== "snapshot") throw new Error("expected snapshot");
    const ref = snapshot.nodes[0]?.children[0]?.ref ?? "missing";
    const baseResponse = clickContents.debugger.response;
    clickContents.debugger.response = (method, params) => {
      if (method === "Input.dispatchMouseEvent" && params?.type === "mouseReleased") {
        clickContents.loading = true;
        clickContents.url = "https://example.test/click-committed";
        driver.didStartNavigation(clickContents);
        driver.didNavigate(clickContents);
      }
      return baseResponse(method, params);
    };
    const clicking = driver.run("bt_2", {
      kind: "click",
      ref,
      snapshotGeneration: snapshot.generation,
    }, 10, 0, 10_000);
    await vi.waitFor(() => expect(driver.getPageState("bt_2", 10)?.navigationEpoch).toBe(1));
    driver.cancel("bt_2", 10);
    await expect(clicking).rejects.toMatchObject({ name: "AbortError" });
    expect(clickContents.stopCalls).toBe(0);
    configurePage(clickContents);
    await expect(driver.run("bt_2", { kind: "snapshot" }, 10, 1)).resolves.toMatchObject({ navigationEpoch: 1 });
  });

  it("waits for a delayed explicit navigation commit and readiness", async () => {
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    webContents.debugger.response = (method) => {
      if (method === "Page.navigate") {
        setTimeout(() => {
          webContents.loading = true;
          driver.didStartNavigation(webContents);
          setTimeout(() => {
            webContents.url = "https://example.test/delayed";
            driver.didNavigate(webContents);
            webContents.loading = false;
          }, 100);
        }, 150);
      }
      return {};
    };
    register(driver, webContents);

    await expect(driver.run("bt_1", {
      kind: "navigate",
      url: "https://example.test/delayed",
    }, 10, 0, 1_000)).resolves.toMatchObject({
      navigationEpoch: 1,
      ready: true,
      url: "https://example.test/delayed",
    });
  });

  it("stops only an in-flight navigation and rejects oversized screenshots", async () => {
    const driver = new DesktopBrowserAutomationDriver();
    const webContents = new FakeWebContents();
    const navigateControl = { resolve: () => {} };
    webContents.debugger.response = (method) => {
      if (method === "Page.navigate") {
        return new Promise<void>((resolve) => {
          navigateControl.resolve = resolve;
        });
      }
      if (method === "Page.captureScreenshot") {
        return { data: "A".repeat(Math.ceil((BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES * 4) / 3) + 4) };
      }
      return {};
    };
    register(driver, webContents);

    const navigating = driver.run("bt_1", { kind: "navigate", url: "https://example.test/next" }, 10, 0);
    await Promise.resolve();
    driver.cancel("bt_1", 10);
    expect(webContents.stopCalls).toBe(1);
    navigateControl.resolve();
    await expect(navigating).rejects.toMatchObject({ name: "AbortError" });

    await expect(driver.run("bt_1", { kind: "screenshot" }, 10, 0)).rejects.toThrow("size limit");
    expect(webContents.destroyed).toBe(false);
  });
});
