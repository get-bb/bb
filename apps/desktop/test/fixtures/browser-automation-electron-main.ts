import { app, BrowserWindow, nativeImage } from "electron";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { BROWSER_AUTOMATION_MAX_AX_NODES } from "@bb/domain";
import {
  createDesktopBrowserViewManager,
  type DesktopBrowserHostWindow,
  type DesktopBrowserViewManager,
} from "../../src/desktop-browser-view.js";
import type {
  BrowserAutomationCommandResult,
  BrowserAutomationSnapshotNode,
} from "../../src/desktop-browser-automation.js";

const COMMAND_TIMEOUT_MS = 15_000;
const FIXTURE_BUNDLE_PATH = (() => {
  const value = process.env.BB_BROWSER_FIXTURE_BUNDLE;
  if (value === undefined) throw new Error("BB_BROWSER_FIXTURE_BUNDLE is required");
  return value;
})();

interface FixtureEvent {
  clientX?: number;
  compromised?: boolean;
  clientY?: number;
  count?: number;
  key?: string;
  label?: string;
  pointerType?: string;
  type: string;
  value?: string;
  viewportHeight?: number;
  viewportWidth?: number;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function eventFrom(value: object): FixtureEvent {
  const record = value as FixtureEvent;
  assert(typeof record.type === "string", "Fixture event requires a type");
  return record;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    request.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > 16_384) {
        reject(new Error("Fixture request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function html(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;min-height:100%;font:16px sans-serif}body{overflow-x:hidden}main{padding:16px}label,input,select,[contenteditable],button{display:block;margin:12px 0;padding:8px}[contenteditable]{border:1px solid #333;min-height:36px}.spacer{height:900px}.clipped{position:relative;left:760px;width:180px}#visual{width:100vw;height:100vh;background:rgb(10,30,200);display:grid;place-items:center}#visual strong{display:grid;place-items:center;width:50%;height:50%;background:rgb(220,20,20);color:white;font-size:40px}</style></head><body>${body}</body></html>`;
}

async function createFixtureServer() {
  const browserBundle = await readFile(FIXTURE_BUNDLE_PATH, "utf8");
  const events: FixtureEvent[] = [];
  const hangingResponses = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/events") {
      try {
        const parsed = JSON.parse(await readBody(request));
        assert(typeof parsed === "object" && parsed !== null, "Fixture event must be an object");
        events.push(eventFrom(parsed));
        response.writeHead(204).end();
      } catch (error) {
        response.writeHead(400).end(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (url.pathname === "/fixture") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html('<div id="root"></div><script src="/fixture.js"></script>'));
      return;
    }
    if (url.pathname === "/fixture.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(browserBundle);
      return;
    }
    if (url.pathname === "/document") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html("<h1>Full document ready</h1>"));
      return;
    }
    if (url.pathname === "/delayed") {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(html("<h1>Delayed document ready</h1>"));
      }, 700);
      return;
    }
    if (url.pathname === "/large") {
      const nodes = Array.from({ length: 1_500 }, (_, index) => `<button>Large item ${index}</button>`).join("");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html(`<h1>Large page intact</h1><div id="items">${nodes}</div><script>setTimeout(()=>{const marker=document.createElement("strong");marker.textContent="Large ready marker";document.body.prepend(marker)},400)</script>`));
      return;
    }
    if (url.pathname === "/visual") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html('<div id="visual"><strong>INACTIVE TARGET</strong></div>'));
      return;
    }
    if (url.pathname === "/hang") {
      hangingResponses.add(response);
      request.on("close", () => hangingResponses.delete(response));
      return;
    }
    response.writeHead(404).end("not found");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address !== null && typeof address !== "string", "Fixture server did not bind a port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    events,
    close: async () => {
      for (const response of hangingResponses) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function flatten(nodes: readonly BrowserAutomationSnapshotNode[]): BrowserAutomationSnapshotNode[] {
  const result: BrowserAutomationSnapshotNode[] = [];
  const pending = [...nodes].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    result.push(node);
    for (const child of [...node.children].reverse()) pending.push(child);
  }
  return result;
}

function requireSnapshot(result: BrowserAutomationCommandResult): BrowserAutomationCommandResult & { kind: "snapshot" } {
  assert(result.kind === "snapshot", `Expected snapshot, received ${result.kind}`);
  return result;
}

function requireState(result: BrowserAutomationCommandResult): BrowserAutomationCommandResult & { kind: "state" } {
  assert(result.kind === "state", `Expected state, received ${result.kind}`);
  return result;
}

function requireRef(snapshot: BrowserAutomationCommandResult & { kind: "snapshot" }, name: string, role: string): string {
  const node = flatten(snapshot.nodes).find((candidate) => candidate.name === name && candidate.role.toLowerCase() === role.toLowerCase());
  assert(node !== undefined, `Snapshot did not contain ${role} ${name}`);
  assert(node.ref !== undefined, `Snapshot node ${name} did not have a ref`);
  return node.ref;
}

async function waitFor<T>(read: () => T | undefined, message: string, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

function countEvent(events: readonly FixtureEvent[], type: string): number {
  return events.filter((event) => event.type === type).length;
}

async function waitReady(manager: DesktopBrowserViewManager, hostWindow: DesktopBrowserHostWindow, targetId: string, urlPart: string) {
  return waitFor(() => {
    const state = manager.getAutomationPageState({ hostWindow, targetId });
    return state?.ready === true && state.url.includes(urlPart) ? state : undefined;
  }, `Target ${targetId} did not become ready at ${urlPart}`, 10_000);
}

async function runCommand(manager: DesktopBrowserViewManager, hostWindow: DesktopBrowserHostWindow, targetId: string, command: Parameters<DesktopBrowserViewManager["runAutomationCommand"]>[0]["command"], timeoutMs = COMMAND_TIMEOUT_MS) {
  const state = manager.getAutomationPageState({ hostWindow, targetId });
  assert(state !== null, `Target ${targetId} is not registered`);
  return manager.runAutomationCommand({ hostWindow, targetId, command, navigationEpoch: state.navigationEpoch, timeoutMs });
}

async function runAcceptance(): Promise<string[]> {
  const fixture = await createFixtureServer();
  const hostWindow = new BrowserWindow({ width: 820, height: 640, show: true });
  await hostWindow.loadURL("data:text/html,<title>bb browser fixture host</title>");
  const manager = createDesktopBrowserViewManager({
    activateHostWindow: () => {
      app.focus({ steal: true });
      hostWindow.focus();
    },
    dispatchAppCommand: () => {},
    focusHostWebContents: () => {},
    partition: `persist:bb-browser-acceptance-${process.pid}`,
    resolveAppCommand: () => null,
  });
  const host: DesktopBrowserHostWindow = hostWindow;
  const failures: string[] = [];
  const results: string[] = [];
  const record = (scenario: string) => {
    results.push(scenario);
    process.stdout.write(`scenario: ${scenario}\n`);
  };
  try {
    manager.attach({ hostWindow: host, request: { tabId: "browser:user", url: `${fixture.baseUrl}/document?user=1`, bounds: { x: 0, y: 0, width: 800, height: 600 }, visible: false } });
    assert(!manager.reserveAutomationTarget({ hostWindow: host, tabId: "browser:user", targetId: "bt_user" }), "Existing user tab accepted an automation reservation");
    let userRegistrationRejected = false;
    try {
      manager.registerAutomationTarget({ hostWindow: host, tabId: "browser:user", targetId: "bt_user" });
    } catch {
      userRegistrationRejected = true;
    }
    assert(userRegistrationRejected, "Existing user tab was registered for automation");

    assert(manager.reserveAutomationTarget({ hostWindow: host, tabId: "browser:primary", targetId: "bt_primary" }), "Fresh target reservation failed");
    manager.attach({ hostWindow: host, request: { tabId: "browser:primary", url: `${fixture.baseUrl}/fixture`, bounds: { x: 0, y: 0, width: 800, height: 600 }, visible: true } });
    manager.registerAutomationTarget({ hostWindow: host, tabId: "browser:primary", targetId: "bt_primary" });
    await waitReady(manager, host, "bt_primary", "/fixture");
    hostWindow.show();
    app.focus({ steal: true });
    hostWindow.focus();
    manager.focus({ hostWindow: host, tabId: "browser:primary" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    process.stdout.write("gate: fresh reservation ordering and user-tab rejection\n");

    let snapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    const menuNode = flatten(snapshot.nodes).find((node) => node.name === "Clipped menu trigger");
    assert(menuNode?.visible === false, "Clipped menu target was not initially offscreen");
    await runCommand(manager, host, "bt_primary", { kind: "click", ref: requireRef(snapshot, "Clipped menu trigger", "button"), snapshotGeneration: snapshot.generation });
    const pointer = await waitFor(() => fixture.events.find((event) => event.type === "pointer"), `Native pointer event was not observed: ${JSON.stringify(fixture.events)}`);
    assert(pointer.pointerType === "mouse", "Click did not produce a mouse pointer event");
    assert(typeof pointer.clientX === "number" && typeof pointer.clientY === "number" && typeof pointer.viewportWidth === "number" && typeof pointer.viewportHeight === "number" && pointer.clientX >= 0 && pointer.clientX <= pointer.viewportWidth && pointer.clientY >= 0 && pointer.clientY <= pointer.viewportHeight, "Pointer click was outside the viewport");
    await runCommand(manager, host, "bt_primary", { kind: "wait", text: "Viewport menu opened" });
    const menuSnapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    assert(flatten(menuSnapshot.nodes).some((node) => node.name.includes("Viewport menu opened") && node.visible), "Pointer menu outcome was not AX-visible");
    record("pointer-driven menu");

    snapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    await runCommand(manager, host, "bt_primary", { kind: "click", ref: requireRef(snapshot, "Nested action", "button"), snapshotGeneration: snapshot.generation });
    await waitFor(() => fixture.events.find((event) => event.type === "nested-click"), "Nested child hit did not activate its owning button");
    let occlusionRejected = false;
    try {
      await runCommand(manager, host, "bt_primary", { kind: "click", ref: requireRef(snapshot, "Occluded action", "button"), snapshotGeneration: snapshot.generation });
    } catch (error) {
      occlusionRejected = error instanceof Error && error.message.includes("occluded or another element intercepts pointer input");
    }
    assert(occlusionRejected, "Occluded pointer target was not rejected actionably");
    assert(!fixture.events.some((event) => event.type === "occluded-click"), "Occluded pointer target received a false-success click");
    process.stdout.write("gate: nested pointer target accepted and overlay interception rejected\n");

    snapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    await runCommand(manager, host, "bt_primary", { kind: "type", ref: requireRef(snapshot, "Controlled name", "textbox"), text: "Ada", snapshotGeneration: snapshot.generation });
    await waitFor(() => fixture.events.find((event) => event.type === "controlled" && event.value === "Ada"), "React controlled input did not update");
    const controlledSnapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    assert(flatten(controlledSnapshot.nodes).some((node) => node.name === "Controlled name" && node.value === "Ada" && node.visible), "React controlled input value was not AX-visible");
    record("React controlled form");

    snapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    await runCommand(manager, host, "bt_primary", { kind: "type", ref: requireRef(snapshot, "Rich editor", "textbox"), text: "Rich native text", snapshotGeneration: snapshot.generation });
    await waitFor(() => fixture.events.find((event) => event.type === "rich" && event.value?.includes("Rich native text") === true), "Contenteditable input did not update");
    const richSnapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    assert(flatten(richSnapshot.nodes).some((node) => node.visible && (node.name.includes("Rich native text") || node.value?.includes("Rich native text") === true)), "Rich-text editor outcome was not AX-visible");
    record("rich-text editor");

    snapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    const roleRef = requireRef(snapshot, "Role", "combobox");
    const rejectSelect = async (ref: string, value: string, detail: string) => {
      let rejected = false;
      try {
        await runCommand(manager, host, "bt_primary", { kind: "select", ref, value, snapshotGeneration: snapshot.generation });
      } catch {
        rejected = true;
      }
      assert(rejected, detail);
    };
    await rejectSelect(requireRef(snapshot, "Not a select", "button"), "Admin", "Non-select target was accepted");
    await rejectSelect(roleRef, "missing", "Missing select value was accepted");
    await rejectSelect(roleRef, "dup", "Duplicate exact select value was accepted");
    await rejectSelect(roleRef, "Disabled", "Disabled option was accepted");
    await rejectSelect(requireRef(snapshot, "Disabled role", "combobox"), "Admin", "Disabled select was accepted");
    await rejectSelect(requireRef(snapshot, "Multiple roles", "listbox"), "Admin", "Multiple select was accepted");
    await rejectSelect(requireRef(snapshot, "List roles", "listbox"), "Admin", "Listbox-sized select was accepted");
    const injectionValue = `x\"); globalThis.compromised = true; (\"`;
    await runCommand(manager, host, "bt_primary", { kind: "select", ref: roleRef, value: injectionValue, snapshotGeneration: snapshot.generation });
    await waitFor(() => fixture.events.find((event) => event.type === "select-change" && event.value === injectionValue && event.compromised === false), `Injection-shaped exact value did not remain data: ${JSON.stringify(fixture.events)}`);
    await runCommand(manager, host, "bt_primary", { kind: "select", ref: roleRef, value: "Admin", snapshotGeneration: snapshot.generation });
    const selectedSnapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    const selectedNode = flatten(selectedSnapshot.nodes).find((node) => node.name === "Role" && node.role.toLowerCase() === "combobox");
    try {
      await waitFor(() => fixture.events.find((event) => event.type === "select-input" && event.value === "Admin" && event.label === "Administrator"), `Select input did not choose the exact HTML value: value=${selectedNode?.value ?? "missing"} events=${JSON.stringify(fixture.events)}`);
      await waitFor(() => fixture.events.find((event) => event.type === "select-change" && event.value === "Admin" && event.label === "Administrator"), `Select change did not choose the exact HTML value: value=${selectedNode?.value ?? "missing"} events=${JSON.stringify(fixture.events)}`);
      assert(flatten(selectedSnapshot.nodes).some((node) => node.visible && (node.name.includes("Selected role: Admin") || node.value?.includes("Selected role: Admin") === true)), "React controlled select state was not visibly updated");
      record("native select");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(detail);
      process.stdout.write(`scenario failed: ${detail}\n`);
    }

    snapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    await runCommand(manager, host, "bt_primary", { kind: "click", ref: requireRef(snapshot, "Keyboard target", "textbox"), snapshotGeneration: snapshot.generation });
    await runCommand(manager, host, "bt_primary", { kind: "press", key: "Enter" });
    await waitFor(() => fixture.events.find((event) => event.type === "press" && event.key === "Enter" && event.count === 1), "Normal Enter behavior was not observed");
    const keyboardSnapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    assert(flatten(keyboardSnapshot.nodes).some((node) => node.name.includes("Enter presses: 1") && node.visible), "Normal keyboard output was not AX-visible");
    await runCommand(manager, host, "bt_primary", { kind: "click", ref: requireRef(keyboardSnapshot, "Form search", "textbox"), snapshotGeneration: keyboardSnapshot.generation });
    await runCommand(manager, host, "bt_primary", { kind: "press", key: "Enter" });
    await waitFor(() => fixture.events.find((event) => event.type === "form-submit" && event.count === 1), "Enter did not trigger the form's native default submit action");
    const formSnapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    assert(flatten(formSnapshot.nodes).some((node) => node.name.includes("Form submits: 1") && node.visible), "Form default action was not AX-visible");
    process.stdout.write("gate: normal keyboard press and default form action with AX-visible output\n");

    snapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    const beforeSpaEpoch = snapshot.navigationEpoch;
    const spa = requireState(await runCommand(manager, host, "bt_primary", { kind: "click", ref: requireRef(snapshot, "SPA after 200ms", "button"), snapshotGeneration: snapshot.generation }));
    assert(spa.url.endsWith("/fixture#spa-ready") && spa.navigationEpoch > beforeSpaEpoch && spa.ready, "SPA action navigation did not settle with the resulting state");
    const spaSnapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    assert(flatten(spaSnapshot.nodes).some((node) => node.name.includes("SPA route ready") && node.visible), "SPA routing outcome was not AX-visible");
    record("SPA routing");

    const documentState = requireState(await runCommand(manager, host, "bt_primary", { kind: "click", ref: requireRef(spaSnapshot, "Document after 200ms", "button"), snapshotGeneration: spaSnapshot.generation }));
    assert(documentState.url.includes("/document?from=action") && documentState.navigationEpoch > spa.navigationEpoch && documentState.ready, "Document action navigation did not settle with the resulting state");
    const documentSnapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    assert(flatten(documentSnapshot.nodes).some((node) => node.name.includes("Full document ready") && node.visible), "Full navigation outcome was not AX-visible");
    record("full navigation");

    const delayedStarted = Date.now();
    const delayedState = requireState(await runCommand(manager, host, "bt_primary", { kind: "navigate", url: `${fixture.baseUrl}/delayed` }));
    assert(Date.now() - delayedStarted >= 600 && delayedState.url.endsWith("/delayed") && delayedState.ready, "Delayed explicit navigation returned before readiness");
    const delayedSnapshot = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    assert(flatten(delayedSnapshot.nodes).some((node) => node.name.includes("Delayed document ready") && node.visible), "Delayed loading outcome was not AX-visible");
    record("delayed loading");

    await runCommand(manager, host, "bt_primary", { kind: "navigate", url: `${fixture.baseUrl}/document?safe=1` });
    let nativeError = false;
    try {
      await runCommand(manager, host, "bt_primary", { kind: "navigate", url: "http://127.0.0.1:1/unsafe-port" }, 2_000);
    } catch (error) {
      nativeError = error instanceof Error && error.message.length > 0;
    }
    assert(nativeError, "Chromium navigation error was not surfaced");
    const safeState = requireState(await runCommand(manager, host, "bt_primary", { kind: "navigate", url: `${fixture.baseUrl}/document?safe=2` }));
    const hungStarted = Date.now();
    const hung = runCommand(manager, host, "bt_primary", { kind: "navigate", url: `${fixture.baseUrl}/hang` }, 10_000).then(
      () => false,
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    manager.cancelAutomationCommand({ hostWindow: host, targetId: "bt_primary" });
    assert(await hung, "Stop did not cancel a slow native navigation");
    assert(Date.now() - hungStarted < 1_500, "Stop did not promptly cancel a slow native navigation");
    await new Promise((resolve) => setTimeout(resolve, 700));
    const afterStop = manager.getAutomationPageState({ hostWindow: host, targetId: "bt_primary" });
    assert(afterStop !== null && afterStop.url === safeState.url && afterStop.navigationEpoch === safeState.navigationEpoch && afterStop.ready, "Stopped native navigation later committed or damaged the page");
    const intact = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    assert(flatten(intact.nodes).some((node) => node.name.includes("Full document ready") && node.visible), "Stopped target was damaged or stuck");
    await runCommand(manager, host, "bt_primary", { kind: "navigate", url: `${fixture.baseUrl}/large` });
    const largeStarted = Date.now();
    const large = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }, 20_000));
    const largeCount = flatten(large.nodes).length;
    assert(largeCount >= 400 && largeCount <= BROWSER_AUTOMATION_MAX_AX_NODES && Date.now() - largeStarted < 15_000, "Large-DOM accessibility snapshot was not bounded");
    await runCommand(manager, host, "bt_primary", { kind: "wait", text: "Large ready marker" }, 10_000);
    const eventsBeforeWaitStop = fixture.events.length;
    const stateBeforeWaitStop = manager.getAutomationPageState({ hostWindow: host, targetId: "bt_primary" });
    const waiting = runCommand(manager, host, "bt_primary", { kind: "wait", text: "Never appears" }, 10_000).then(
      () => false,
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
    const waitStopStarted = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 200));
    manager.cancelAutomationCommand({ hostWindow: host, targetId: "bt_primary" });
    assert(await waiting, "Stop did not cancel large-DOM text waiting");
    assert(Date.now() - waitStopStarted < 1_500, "Stop was not responsive during large-DOM text waiting");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const stateAfterWaitStop = manager.getAutomationPageState({ hostWindow: host, targetId: "bt_primary" });
    assert(fixture.events.length === eventsBeforeWaitStop && stateAfterWaitStop?.url === stateBeforeWaitStop?.url && stateAfterWaitStop?.navigationEpoch === stateBeforeWaitStop?.navigationEpoch, "Cancelled wait caused later input or navigation");
    const afterWaitStop = requireSnapshot(await runCommand(manager, host, "bt_primary", { kind: "snapshot" }));
    assert(flatten(afterWaitStop.nodes).some((node) => node.name.includes("Large page intact") && node.visible), "Cancelled wait damaged or stuck the target");
    record("large DOM");
    record("error and timeout states");

    assert(manager.reserveAutomationTarget({ hostWindow: host, tabId: "browser:visual", targetId: "bt_visual" }), "Inactive screenshot target reservation failed");
    manager.attach({ hostWindow: host, request: { tabId: "browser:visual", url: `${fixture.baseUrl}/visual`, bounds: { x: 0, y: 0, width: 800, height: 600 }, visible: false } });
    manager.registerAutomationTarget({ hostWindow: host, tabId: "browser:visual", targetId: "bt_visual" });
    await waitReady(manager, host, "bt_visual", "/visual");
    process.stdout.write("gate: inactive target state ready\n");
    await runCommand(manager, host, "bt_visual", { kind: "wait", text: "INACTIVE TARGET" });
    process.stdout.write("gate: inactive target AX ready\n");
    const screenshot = await runCommand(manager, host, "bt_visual", { kind: "screenshot" });
    assert(screenshot.kind === "screenshot", "Inactive screenshot command returned the wrong result");
    const png = Buffer.from(screenshot.base64, "base64");
    assert(png.length <= 8 * 1024 * 1024 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "Screenshot was not a bounded PNG");
    const image = nativeImage.createFromBuffer(png);
    const size = image.getSize();
    assert(!image.isEmpty() && size.width >= 700 && size.height >= 500 && size.width <= 2_000 && size.height <= 1_600, "Screenshot dimensions were not meaningful and bounded");
    const bitmap = image.toBitmap();
    const pixel = (x: number, y: number) => {
      const offset = (y * size.width + x) * 4;
      return { blue: bitmap[offset] ?? 0, green: bitmap[offset + 1] ?? 0, red: bitmap[offset + 2] ?? 0 };
    };
    const corner = pixel(Math.floor(size.width * 0.05), Math.floor(size.height * 0.05));
    const center = pixel(Math.floor(size.width * 0.3), Math.floor(size.height * 0.3));
    assert(corner.blue > 140 && corner.red < 80 && center.red > 150 && center.blue < 100, `Inactive screenshot pixels did not show the expected distinct content regions: size=${size.width}x${size.height} corner=${JSON.stringify(corner)} center=${JSON.stringify(center)}`);
    record("screenshot verification");

    assert(countEvent(fixture.events, "menu-open") === 1, "Pointer menu action fired an unexpected number of times");
    if (failures.length > 0) throw new Error(`Electron Browser acceptance blockers: ${failures.join("; ")}`);
    return results;
  } finally {
    manager.destroyAll();
    hostWindow.destroy();
    await fixture.close();
  }
}

app.whenReady().then(async () => {
  try {
    const scenarios = await runAcceptance();
    process.stdout.write(`${JSON.stringify({ ok: true, scenarios })}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    app.exit(1);
  }
});
