import { z } from "zod";
import {
  BROWSER_AUTOMATION_MAX_AX_DEPTH,
  BROWSER_AUTOMATION_MAX_AX_NODES,
  BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES,
  BROWSER_AUTOMATION_MAX_TEXT_LENGTH,
  formatBrowserSnapshotRef,
  type BrowserAutomationCommand as DomainBrowserAutomationCommand,
  type BrowserAutomationKey,
  type BrowserAutomationCommandResult as DomainBrowserAutomationCommandResult,
  type BrowserAutomationSnapshotNode as DomainBrowserAutomationSnapshotNode,
} from "@bb/domain";

const MAX_AX_NODES = BROWSER_AUTOMATION_MAX_AX_NODES;
const MAX_AX_DEPTH = BROWSER_AUTOMATION_MAX_AX_DEPTH;
const MAX_AX_TEXT_LENGTH = 512;
const MAX_SCREENSHOT_BYTES = BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES;
const MAX_TYPE_TEXT_LENGTH = BROWSER_AUTOMATION_MAX_TEXT_LENGTH;
const MAX_WAIT_TEXT_LENGTH = 1_024;
const MAX_SELECT_DOM_NODES = 1_024;
const POLL_INTERVAL_MS = 100;
const ACTION_NAVIGATION_START_GRACE_MS = 500;
const EXACT_NATIVE_SELECT_DOM_OPERATION_WORLD = "bb-exact-native-select";
const EXACT_NATIVE_SELECT_DOM_OPERATION = `function(option) {
  if (option === null) return;
  const parent = option.parentElement;
  if (parent !== this && parent?.parentElement !== this) return;
  option.selected = true;
  const input = this.ownerDocument.createEvent("Event");
  input.initEvent("input", true, false);
  this.dispatchEvent(input);
  const change = this.ownerDocument.createEvent("Event");
  change.initEvent("change", true, false);
  this.dispatchEvent(change);
}`;

const axValueSchema = z.object({ value: z.union([z.string(), z.number(), z.boolean()]) }).passthrough();
const axPropertySchema = z.object({
  name: z.string(),
  value: z.object({ value: z.union([z.string(), z.number(), z.boolean()]).optional() }).passthrough(),
}).passthrough();
const axNodeSchema = z.object({
  backendDOMNodeId: z.number().int().positive().optional(),
  childIds: z.array(z.string()).optional(),
  ignored: z.boolean(),
  name: axValueSchema.optional(),
  nodeId: z.string(),
  properties: z.array(axPropertySchema).optional(),
  role: axValueSchema.optional(),
  value: axValueSchema.optional(),
}).passthrough();
const axTreeSchema = z.object({ nodes: z.array(axNodeSchema) }).passthrough();
const boxModelSchema = z.object({ model: z.object({ content: z.array(z.number()).length(8) }).passthrough() }).passthrough();
const layoutMetricsSchema = z.object({
  cssLayoutViewport: z.object({ clientHeight: z.number().finite().nonnegative(), clientWidth: z.number().finite().nonnegative(), pageX: z.number().finite(), pageY: z.number().finite() }).passthrough(),
  cssVisualViewport: z.object({ pageX: z.number().finite(), pageY: z.number().finite() }).passthrough(),
}).passthrough();
const screenshotSchema = z.object({ data: z.string() }).passthrough();
const navigateResponseSchema = z.object({ errorText: z.string().optional() }).passthrough();
const describedDomNodeSchema = z.object({
  attributes: z.array(z.string()).optional(),
  backendNodeId: z.number().int().positive().optional(),
  children: z.array(z.unknown()).optional(),
  nodeName: z.string(),
  nodeValue: z.string().optional(),
}).passthrough();
const describeNodeResponseSchema = z.object({ node: z.unknown() }).passthrough();
const frameTreeSchema = z.object({
  frameTree: z.object({ frame: z.object({ id: z.string() }).passthrough() }).passthrough(),
}).passthrough();
const isolatedWorldSchema = z.object({ executionContextId: z.number().int().positive() }).passthrough();
const resolvedNodeSchema = z.object({ object: z.object({ objectId: z.string() }).passthrough() }).passthrough();
const nodeForLocationSchema = z.object({ backendNodeId: z.number().int().positive() }).passthrough();

type DescribedDomNode = z.infer<typeof describedDomNodeSchema>;
type CdpCommandParameter = string | number | boolean | readonly { objectId: string }[];
export type BrowserAutomationCommand = DomainBrowserAutomationCommand;

export interface BrowserAutomationPageState {
  navigationEpoch: number;
  ready: boolean;
  url: string;
}

export type BrowserAutomationSnapshotNode = DomainBrowserAutomationSnapshotNode;
export type BrowserAutomationCommandResult = DomainBrowserAutomationCommandResult;

interface DebuggerLike {
  attach(protocolVersion?: string): void;
  detach(): void;
  isAttached(): boolean;
  sendCommand(method: string, commandParams?: Record<string, CdpCommandParameter>): Promise<unknown>;
}

export interface AutomationWebContents {
  debugger: DebuggerLike;
  getURL(): string;
  isDestroyed(): boolean;
  isLoadingMainFrame(): boolean;
  stop(): void;
}

interface InFlightCommand {
  command: BrowserAutomationCommand;
  controller: AbortController;
}

interface AutomationTarget {
  activate: () => void;
  generation: number;
  hostWebContentsId: number;
  inFlight: InFlightCommand | null;
  navigationEpoch: number;
  navigationStarted: number;
  refs: Map<string, number>;
  tabId: string;
  webContents: AutomationWebContents;
}

interface Point {
  x: number;
  y: number;
}

interface KeyDescriptor {
  code: string;
  key: string;
  text?: string;
  windowsVirtualKeyCode: number;
}

const NAMED_KEY_DESCRIPTORS: Readonly<Record<string, KeyDescriptor>> = {
  Enter: { code: "Enter", key: "Enter", text: "\r", windowsVirtualKeyCode: 13 },
  Tab: { code: "Tab", key: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { code: "Escape", key: "Escape", windowsVirtualKeyCode: 27 },
  Space: { code: "Space", key: " ", text: " ", windowsVirtualKeyCode: 32 },
  PageDown: { code: "PageDown", key: "PageDown", windowsVirtualKeyCode: 34 },
  PageUp: { code: "PageUp", key: "PageUp", windowsVirtualKeyCode: 33 },
  ArrowLeft: { code: "ArrowLeft", key: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowUp: { code: "ArrowUp", key: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowRight: { code: "ArrowRight", key: "ArrowRight", windowsVirtualKeyCode: 39 },
  ArrowDown: { code: "ArrowDown", key: "ArrowDown", windowsVirtualKeyCode: 40 },
  Backspace: { code: "Backspace", key: "Backspace", windowsVirtualKeyCode: 8 },
};

const PRINTABLE_KEY_CODES: Readonly<Record<string, { code: string; windowsVirtualKeyCode: number }>> = {
  ";": { code: "Semicolon", windowsVirtualKeyCode: 186 },
  ":": { code: "Semicolon", windowsVirtualKeyCode: 186 },
  "=": { code: "Equal", windowsVirtualKeyCode: 187 },
  "+": { code: "Equal", windowsVirtualKeyCode: 187 },
  ",": { code: "Comma", windowsVirtualKeyCode: 188 },
  "<": { code: "Comma", windowsVirtualKeyCode: 188 },
  "-": { code: "Minus", windowsVirtualKeyCode: 189 },
  "_": { code: "Minus", windowsVirtualKeyCode: 189 },
  ".": { code: "Period", windowsVirtualKeyCode: 190 },
  ">": { code: "Period", windowsVirtualKeyCode: 190 },
  "/": { code: "Slash", windowsVirtualKeyCode: 191 },
  "?": { code: "Slash", windowsVirtualKeyCode: 191 },
  "`": { code: "Backquote", windowsVirtualKeyCode: 192 },
  "~": { code: "Backquote", windowsVirtualKeyCode: 192 },
  "[": { code: "BracketLeft", windowsVirtualKeyCode: 219 },
  "{": { code: "BracketLeft", windowsVirtualKeyCode: 219 },
  "\\": { code: "Backslash", windowsVirtualKeyCode: 220 },
  "|": { code: "Backslash", windowsVirtualKeyCode: 220 },
  "]": { code: "BracketRight", windowsVirtualKeyCode: 221 },
  "}": { code: "BracketRight", windowsVirtualKeyCode: 221 },
  "'": { code: "Quote", windowsVirtualKeyCode: 222 },
  "\"": { code: "Quote", windowsVirtualKeyCode: 222 },
  "!": { code: "Digit1", windowsVirtualKeyCode: 49 },
  "@": { code: "Digit2", windowsVirtualKeyCode: 50 },
  "#": { code: "Digit3", windowsVirtualKeyCode: 51 },
  "$": { code: "Digit4", windowsVirtualKeyCode: 52 },
  "%": { code: "Digit5", windowsVirtualKeyCode: 53 },
  "^": { code: "Digit6", windowsVirtualKeyCode: 54 },
  "&": { code: "Digit7", windowsVirtualKeyCode: 55 },
  "*": { code: "Digit8", windowsVirtualKeyCode: 56 },
  "(": { code: "Digit9", windowsVirtualKeyCode: 57 },
  ")": { code: "Digit0", windowsVirtualKeyCode: 48 },
};

export type DesktopBrowserAutomationErrorCode =
  | "stale_revision"
  | "native_operation_failed";

export class DesktopBrowserAutomationError extends Error {
  constructor(
    readonly code: DesktopBrowserAutomationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DesktopBrowserAutomationError";
  }
}

export function classifyDesktopBrowserAutomationError(
  error: unknown,
): "cancelled" | DesktopBrowserAutomationErrorCode {
  if (error instanceof Error && error.name === "AbortError") return "cancelled";
  if (error instanceof DesktopBrowserAutomationError) return error.code;
  return "native_operation_failed";
}

function textValue(value: z.infer<typeof axValueSchema> | undefined): string {
  if (value === undefined) return "";
  return String(value.value).slice(0, MAX_AX_TEXT_LENGTH);
}

function propertyValue(node: z.infer<typeof axNodeSchema>, name: string): string | number | boolean | undefined {
  return node.properties?.find((property) => property.name === name)?.value.value;
}

function requireBounded(value: string, max: number, name: string): void {
  if (value.length === 0 || value.length > max) {
    throw new Error(`${name} must contain between 1 and ${max} characters`);
  }
}

function abortError(): Error {
  const error = new Error("Browser automation command cancelled");
  error.name = "AbortError";
  return error;
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  assertActive(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error: Error) => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.aborted ? abortError() : error);
      },
    );
  });
}

function pageState(target: AutomationTarget): BrowserAutomationPageState {
  return {
    navigationEpoch: target.navigationEpoch,
    ready: !target.webContents.isLoadingMainFrame(),
    url: target.webContents.getURL(),
  };
}

function clipPolygon(points: readonly Point[], width: number, height: number): Point[] {
  const boundaries: Array<{
    inside(point: Point): boolean;
    intersect(left: Point, right: Point): Point;
  }> = [
    { inside: (point) => point.x >= 0, intersect: (left, right) => ({ x: 0, y: left.y + ((right.y - left.y) * -left.x) / (right.x - left.x) }) },
    { inside: (point) => point.x <= width, intersect: (left, right) => ({ x: width, y: left.y + ((right.y - left.y) * (width - left.x)) / (right.x - left.x) }) },
    { inside: (point) => point.y >= 0, intersect: (left, right) => ({ x: left.x + ((right.x - left.x) * -left.y) / (right.y - left.y), y: 0 }) },
    { inside: (point) => point.y <= height, intersect: (left, right) => ({ x: left.x + ((right.x - left.x) * (height - left.y)) / (right.y - left.y), y: height }) },
  ];
  let output = [...points];
  for (const boundary of boundaries) {
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index];
      const previous = input[(index + input.length - 1) % input.length];
      if (current === undefined || previous === undefined) continue;
      const currentInside = boundary.inside(current);
      const previousInside = boundary.inside(previous);
      if (currentInside !== previousInside) output.push(boundary.intersect(previous, current));
      if (currentInside) output.push(current);
    }
  }
  return output.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function polygonCenter(points: readonly Point[]): Point | null {
  if (points.length === 0) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function quadPoints(content: readonly number[]): Point[] {
  return [
    { x: content[0] ?? 0, y: content[1] ?? 0 },
    { x: content[2] ?? 0, y: content[3] ?? 0 },
    { x: content[4] ?? 0, y: content[5] ?? 0 },
    { x: content[6] ?? 0, y: content[7] ?? 0 },
  ];
}

function keyDescriptor(key: BrowserAutomationKey): KeyDescriptor {
  const named = NAMED_KEY_DESCRIPTORS[key];
  if (named !== undefined) return named;
  if (key === " ") return NAMED_KEY_DESCRIPTORS.Space ?? { code: "Space", key, text: key, windowsVirtualKeyCode: 32 };
  if (/^[A-Za-z]$/.test(key)) {
    const upper = key.toUpperCase();
    return { code: `Key${upper}`, key, text: key, windowsVirtualKeyCode: upper.charCodeAt(0) };
  }
  if (/^[0-9]$/.test(key)) {
    return { code: `Digit${key}`, key, text: key, windowsVirtualKeyCode: key.charCodeAt(0) };
  }
  const punctuation = PRINTABLE_KEY_CODES[key];
  if (punctuation !== undefined) return { ...punctuation, key, text: key };
  return { code: "Unidentified", key, text: key, windowsVirtualKeyCode: key.charCodeAt(0) };
}

function describedNodeContains(
  root: DescribedDomNode,
  backendNodeId: number,
): boolean {
  const pending: Array<{ depth: number; node: DescribedDomNode }> = [{ depth: 0, node: root }];
  let visited = 0;
  while (pending.length > 0 && visited < 64) {
    const next = pending.pop();
    if (next === undefined) break;
    visited += 1;
    if (next.node.backendNodeId === backendNodeId) return true;
    if (next.depth >= 4) continue;
    for (const child of next.node.children ?? []) {
      pending.push({ depth: next.depth + 1, node: describedDomNodeSchema.parse(child) });
    }
  }
  return false;
}

function attributes(node: DescribedDomNode): Map<string, string> {
  const result = new Map<string, string>();
  const raw = node.attributes ?? [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const name = raw[index];
    const value = raw[index + 1];
    if (name !== undefined && value !== undefined) result.set(name, value);
  }
  return result;
}

export class DesktopBrowserAutomationDriver {
  private readonly targets = new Map<string, AutomationTarget>();

  register(args: {
    activate: () => void;
    hostWebContentsId: number;
    tabId: string;
    targetId: string;
    webContents: AutomationWebContents;
  }): void {
    if (this.targets.has(args.targetId)) throw new Error("Browser automation target already registered");
    for (const target of this.targets.values()) {
      if (target.webContents === args.webContents) throw new Error("Browser automation tab is already owned");
    }
    if (args.webContents.isDestroyed()) throw new Error("Browser automation tab is unavailable");
    args.webContents.debugger.attach("1.3");
    this.targets.set(args.targetId, {
      activate: args.activate,
      generation: 0,
      hostWebContentsId: args.hostWebContentsId,
      inFlight: null,
      navigationEpoch: 0,
      navigationStarted: 0,
      refs: new Map(),
      tabId: args.tabId,
      webContents: args.webContents,
    });
  }

  unregister(targetId: string, hostWebContentsId?: number): void {
    const target = this.targets.get(targetId);
    if (target === undefined || (hostWebContentsId !== undefined && target.hostWebContentsId !== hostWebContentsId)) return;
    this.targets.delete(targetId);
    target.inFlight?.controller.abort();
    target.inFlight = null;
    target.refs.clear();
    if (target.webContents.debugger.isAttached()) target.webContents.debugger.detach();
  }

  didStartNavigation(webContents: AutomationWebContents): void {
    for (const target of this.targets.values()) {
      if (target.webContents === webContents) target.navigationStarted += 1;
    }
  }

  didNavigate(webContents: AutomationWebContents): void {
    for (const target of this.targets.values()) {
      if (target.webContents !== webContents) continue;
      target.navigationEpoch += 1;
      target.generation += 1;
      target.refs.clear();
    }
  }

  unregisterWebContents(webContents: AutomationWebContents): void {
    for (const [targetId, target] of this.targets) {
      if (target.webContents === webContents) this.unregister(targetId);
    }
  }

  cancel(targetId: string, hostWebContentsId?: number): void {
    const target = this.targets.get(targetId);
    if (target === undefined || (hostWebContentsId !== undefined && target.hostWebContentsId !== hostWebContentsId)) return;
    this.interrupt(target);
  }

  getPageState(targetId: string, hostWebContentsId?: number): BrowserAutomationPageState | null {
    const target = this.targets.get(targetId);
    if (target === undefined || (hostWebContentsId !== undefined && target.hostWebContentsId !== hostWebContentsId)) return null;
    return pageState(target);
  }

  destroy(): void {
    for (const targetId of [...this.targets.keys()]) this.unregister(targetId);
  }

  async run(
    targetId: string,
    command: BrowserAutomationCommand,
    hostWebContentsId?: number,
    navigationEpoch?: number,
    timeoutMs = 30_000,
  ): Promise<BrowserAutomationCommandResult> {
    const target = this.targets.get(targetId);
    if (target === undefined || target.webContents.isDestroyed() || (hostWebContentsId !== undefined && target.hostWebContentsId !== hostWebContentsId)) throw new Error("Browser automation target not found");
    if (
      navigationEpoch !== undefined &&
      navigationEpoch !== target.navigationEpoch &&
      !(["wait", "snapshot", "screenshot"].includes(command.kind) && navigationEpoch < target.navigationEpoch)
    ) throw new DesktopBrowserAutomationError("stale_revision", "Browser automation revision is stale");
    if ("snapshotGeneration" in command && command.snapshotGeneration !== target.generation) throw new DesktopBrowserAutomationError("stale_revision", "Browser automation reference generation is stale");
    if (target.inFlight !== null) throw new Error("Browser automation target is busy");
    const controller = new AbortController();
    const inFlight = { command, controller };
    target.inFlight = inFlight;
    const timeout = setTimeout(() => this.interrupt(target, inFlight), timeoutMs);
    try {
      return await this.execute(target, command, controller.signal, Date.now() + timeoutMs);
    } finally {
      clearTimeout(timeout);
      if (target.inFlight === inFlight) target.inFlight = null;
    }
  }

  private interrupt(target: AutomationTarget, expected?: InFlightCommand): void {
    const inFlight = target.inFlight;
    if (inFlight === null || (expected !== undefined && inFlight !== expected) || inFlight.controller.signal.aborted) return;
    inFlight.controller.abort();
    if (inFlight.command.kind === "navigate") target.webContents.stop();
    if (target.webContents.debugger.isAttached()) {
      try {
        target.webContents.debugger.detach();
      } catch {}
    }
    if (!target.webContents.isDestroyed()) {
      try {
        target.webContents.debugger.attach("1.3");
      } catch {}
    }
  }

  private sendCommand(
    target: AutomationTarget,
    signal: AbortSignal,
    method: string,
    params?: Record<string, CdpCommandParameter>,
  ): Promise<unknown> {
    assertActive(signal);
    return raceAbort(target.webContents.debugger.sendCommand(method, params), signal);
  }

  private async execute(
    target: AutomationTarget,
    command: BrowserAutomationCommand,
    signal: AbortSignal,
    deadline: number,
  ): Promise<BrowserAutomationCommandResult> {
    assertActive(signal);
    if (command.kind === "navigate") {
      requireBounded(command.url, 4096, "url");
      const url = new URL(command.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Browser automation URLs must be http or https");
      const startingEpoch = target.navigationEpoch;
      const response = navigateResponseSchema.parse(await this.sendCommand(target, signal, "Page.navigate", { url: command.url }));
      if (response.errorText !== undefined && response.errorText.length > 0) throw new Error(response.errorText);
      await this.waitForNavigation(target, startingEpoch, signal, deadline);
      return { kind: "state", ...pageState(target) };
    }
    if (command.kind === "wait") {
      requireBounded(command.text, MAX_WAIT_TEXT_LENGTH, "text");
      while (Date.now() < deadline) {
        if (await this.axContainsText(target, signal, command.text)) return this.snapshot(target, signal);
        await delay(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())), signal);
      }
      throw new Error("Browser automation wait timed out");
    }
    if (command.kind === "snapshot") return this.snapshot(target, signal);
    if (command.kind === "screenshot") {
      const response = screenshotSchema.parse(await this.sendCommand(target, signal, "Page.captureScreenshot", { format: "png", fromSurface: true }));
      if (Buffer.byteLength(response.data, "base64") > MAX_SCREENSHOT_BYTES) throw new Error("Browser automation screenshot exceeds the size limit");
      return { kind: "screenshot", base64: response.data, mimeType: "image/png", ...pageState(target) };
    }
    const startingEpoch = target.navigationEpoch;
    const startingNavigation = target.navigationStarted;
    target.activate();
    if (command.kind === "press") {
      requireBounded(command.key, 64, "key");
      await this.press(target, command.key, signal);
    } else {
      const backendNodeId = this.resolveRef(target, command.ref);
      if (command.kind === "click") {
        const point = await this.hitPoint(target, backendNodeId, signal);
        await this.click(target, point, signal);
      } else if (command.kind === "type") {
        if (command.text.length > MAX_TYPE_TEXT_LENGTH) throw new Error(`text must be at most ${MAX_TYPE_TEXT_LENGTH} characters`);
        await this.sendCommand(target, signal, "DOM.focus", { backendNodeId });
        await this.sendCommand(target, signal, "Input.insertText", { text: command.text });
      } else {
        requireBounded(command.value, MAX_AX_TEXT_LENGTH, "value");
        const option = await this.resolveExactNativeSelectOption(target, backendNodeId, command.value, signal);
        if (target.navigationEpoch !== startingEpoch || target.generation !== command.snapshotGeneration) {
          throw new DesktopBrowserAutomationError("stale_revision", "Browser automation select reference became stale before execution");
        }
        await this.applyExactNativeSelectDomOperation(target, backendNodeId, option.backendNodeId, signal);
        await this.verifyExactNativeSelectOption(target, option.backendNodeId, signal);
      }
    }
    await this.settleAction(target, startingEpoch, startingNavigation, signal, deadline);
    return { kind: "state", ...pageState(target) };
  }

  private resolveRef(target: AutomationTarget, ref: string): number {
    const backendNodeId = target.refs.get(ref);
    if (backendNodeId === undefined) throw new DesktopBrowserAutomationError("stale_revision", "Browser automation reference is stale");
    return backendNodeId;
  }

  private async hitPoint(target: AutomationTarget, backendNodeId: number, signal: AbortSignal): Promise<Point> {
    await this.sendCommand(target, signal, "DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const response = boxModelSchema.parse(await this.sendCommand(target, signal, "DOM.getBoxModel", { backendNodeId }));
    const metrics = layoutMetricsSchema.parse(await this.sendCommand(target, signal, "Page.getLayoutMetrics"));
    const clipped = clipPolygon(quadPoints(response.model.content), metrics.cssLayoutViewport.clientWidth, metrics.cssLayoutViewport.clientHeight);
    const center = polygonCenter(clipped);
    if (center === null) throw new Error("Browser automation target has no in-viewport hit point");
    const candidates = [
      center,
      ...clipped.map((vertex) => ({
        x: center.x + (vertex.x - center.x) * 0.5,
        y: center.y + (vertex.y - center.y) * 0.5,
      })),
    ];
    const targetDescription = describedDomNodeSchema.parse(
      describeNodeResponseSchema.parse(await this.sendCommand(target, signal, "DOM.describeNode", {
        backendNodeId,
        depth: 4,
        pierce: false,
      })).node,
    );
    const offsets = [
      { x: 0, y: 0 },
      { x: metrics.cssLayoutViewport.pageX, y: 0 },
      { x: 0, y: metrics.cssLayoutViewport.pageY },
      {
        x: metrics.cssLayoutViewport.pageX,
        y: metrics.cssLayoutViewport.pageY,
      },
    ];
    for (const offset of offsets) {
      for (const point of candidates) {
        let hit: z.infer<typeof nodeForLocationSchema>;
        try {
          hit = nodeForLocationSchema.parse(await this.sendCommand(target, signal, "DOM.getNodeForLocation", {
            x: Math.round(point.x + offset.x),
            y: Math.round(point.y + offset.y),
            includeUserAgentShadowDOM: false,
            ignorePointerEventsNone: false,
          }));
        } catch (error) {
          if (signal.aborted) throw error;
          continue;
        }
        if (hit.backendNodeId === backendNodeId) return point;
        const hitDescription = describedDomNodeSchema.parse(
          describeNodeResponseSchema.parse(await this.sendCommand(target, signal, "DOM.describeNode", {
            backendNodeId: hit.backendNodeId,
            depth: 4,
            pierce: false,
          })).node,
        );
        if (
          describedNodeContains(targetDescription, hit.backendNodeId) ||
          describedNodeContains(hitDescription, backendNodeId)
        ) {
          return point;
        }
      }
    }
    throw new Error("Browser automation target is occluded or another element intercepts pointer input; take a new snapshot or dismiss the overlay");
  }

  private async click(target: AutomationTarget, point: Point, signal: AbortSignal): Promise<void> {
    await this.sendCommand(target, signal, "Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none", buttons: 0 });
    await this.sendCommand(target, signal, "Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
    await this.sendCommand(target, signal, "Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
  }

  private async press(target: AutomationTarget, key: BrowserAutomationKey, signal: AbortSignal): Promise<void> {
    const descriptor = keyDescriptor(key);
    await this.sendCommand(target, signal, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: descriptor.key,
      code: descriptor.code,
      windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode,
      ...(descriptor.text === undefined ? {} : { text: descriptor.text, unmodifiedText: descriptor.text }),
    });
    await this.sendCommand(target, signal, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: descriptor.key,
      code: descriptor.code,
      windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode,
    });
  }

  private async settleAction(
    target: AutomationTarget,
    startingEpoch: number,
    startingNavigation: number,
    signal: AbortSignal,
    deadline: number,
  ): Promise<void> {
    const observationDeadline = Math.min(deadline, Date.now() + ACTION_NAVIGATION_START_GRACE_MS);
    while (
      target.navigationEpoch === startingEpoch &&
      target.navigationStarted === startingNavigation &&
      Date.now() < observationDeadline
    ) {
      await delay(Math.min(POLL_INTERVAL_MS, Math.max(1, observationDeadline - Date.now())), signal);
    }
    if (target.navigationEpoch !== startingEpoch || target.navigationStarted !== startingNavigation) {
      await this.waitForNavigation(target, startingEpoch, signal, deadline);
    }
    assertActive(signal);
  }

  private async waitForNavigation(
    target: AutomationTarget,
    startingEpoch: number,
    signal: AbortSignal,
    deadline: number,
  ): Promise<void> {
    while (target.navigationEpoch === startingEpoch) {
      if (Date.now() >= deadline) throw new Error("Browser automation navigation did not commit before the deadline");
      await delay(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())), signal);
    }
    while (target.webContents.isLoadingMainFrame()) {
      if (Date.now() >= deadline) throw new Error("Browser automation navigation timed out");
      await delay(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())), signal);
    }
    assertActive(signal);
  }

  private async axContainsText(target: AutomationTarget, signal: AbortSignal, text: string): Promise<boolean> {
    const response = axTreeSchema.parse(await this.sendCommand(target, signal, "Accessibility.getFullAXTree", { depth: MAX_AX_DEPTH }));
    for (const node of response.nodes.slice(0, MAX_AX_NODES)) {
      if (textValue(node.name).includes(text) || textValue(node.value).includes(text)) return true;
    }
    return false;
  }

  private async resolveExactNativeSelectOption(
    target: AutomationTarget,
    backendNodeId: number,
    value: string,
    signal: AbortSignal,
  ): Promise<{ backendNodeId: number }> {
    const response = describeNodeResponseSchema.parse(await this.sendCommand(target, signal, "DOM.describeNode", { backendNodeId, depth: 3, pierce: false }));
    const root = describedDomNodeSchema.parse(response.node);
    if (root.nodeName.toUpperCase() !== "SELECT") throw new Error("Browser automation select reference is not a native select");
    const selectAttributes = attributes(root);
    if (selectAttributes.has("disabled")) throw new Error("Browser automation select is disabled");
    if (selectAttributes.has("multiple")) throw new Error("Browser automation select does not support multiple values");
    const size = Number(selectAttributes.get("size") ?? "0");
    if (Number.isFinite(size) && size > 1) throw new Error("Browser automation select size is not supported");
    const selectAx = axTreeSchema.parse(await this.sendCommand(target, signal, "Accessibility.getPartialAXTree", { backendNodeId, fetchRelatives: false }));
    const selectAxNode = selectAx.nodes.find((node) => node.backendDOMNodeId === backendNodeId) ?? selectAx.nodes[0];
    if (selectAxNode === undefined || propertyValue(selectAxNode, "disabled") === true) throw new Error("Browser automation select is disabled");
    const pending = [...(root.children ?? [])].reverse().map((raw) => ({
      disabledParent: false,
      raw,
    }));
    const options: Array<{ disabled: boolean; node: DescribedDomNode }> = [];
    let count = 0;
    while (pending.length > 0) {
      const next = pending.pop();
      if (next === undefined) break;
      const node = describedDomNodeSchema.parse(next.raw);
      const nodeName = node.nodeName.toUpperCase();
      const disabled = next.disabledParent || attributes(node).has("disabled");
      count += 1;
      if (count > MAX_SELECT_DOM_NODES) throw new Error("Browser automation select exceeds the option limit");
      if (nodeName === "OPTION") options.push({ disabled, node });
      for (const child of [...(node.children ?? [])].reverse()) {
        pending.push({
          disabledParent: disabled && nodeName === "OPTGROUP",
          raw: child,
        });
      }
    }
    const matches: number[] = [];
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index];
      if (option === undefined) continue;
      const explicitValue = attributes(option.node).get("value");
      const optionValue = explicitValue ?? (option.node.children ?? []).map((child) => describedDomNodeSchema.parse(child).nodeValue ?? "").join("");
      if (optionValue === value) matches.push(index);
    }
    if (matches.length === 0) throw new Error("Browser automation select value was not found");
    if (matches.length > 1) throw new Error("Browser automation select value is ambiguous");
    const matchedIndex = matches[0] ?? 0;
    const matched = options[matchedIndex];
    if (matched?.disabled === true) throw new Error("Browser automation select value is disabled");
    if (matched?.node.backendNodeId === undefined) throw new Error("Browser automation select option could not be resolved exactly");
    return { backendNodeId: matched.node.backendNodeId };
  }

  private async applyExactNativeSelectDomOperation(
    target: AutomationTarget,
    backendNodeId: number,
    optionBackendNodeId: number,
    signal: AbortSignal,
  ): Promise<void> {
    const frameTree = frameTreeSchema.parse(await this.sendCommand(target, signal, "Page.getFrameTree"));
    const world = isolatedWorldSchema.parse(await this.sendCommand(target, signal, "Page.createIsolatedWorld", {
      frameId: frameTree.frameTree.frame.id,
      grantUniveralAccess: false,
      worldName: EXACT_NATIVE_SELECT_DOM_OPERATION_WORLD,
    }));
    const select = resolvedNodeSchema.parse(await this.sendCommand(target, signal, "DOM.resolveNode", {
      backendNodeId,
      executionContextId: world.executionContextId,
    }));
    let optionObjectId: string | null = null;
    try {
      const option = resolvedNodeSchema.parse(await this.sendCommand(target, signal, "DOM.resolveNode", {
        backendNodeId: optionBackendNodeId,
        executionContextId: world.executionContextId,
      }));
      optionObjectId = option.object.objectId;
      await this.sendCommand(target, signal, "Runtime.callFunctionOn", {
        arguments: [{ objectId: optionObjectId }],
        awaitPromise: false,
        functionDeclaration: EXACT_NATIVE_SELECT_DOM_OPERATION,
        objectId: select.object.objectId,
        returnByValue: false,
      });
    } finally {
      if (!signal.aborted) {
        if (optionObjectId !== null) await this.sendCommand(target, signal, "Runtime.releaseObject", { objectId: optionObjectId });
        await this.sendCommand(target, signal, "Runtime.releaseObject", { objectId: select.object.objectId });
      }
    }
  }

  private async verifyExactNativeSelectOption(
    target: AutomationTarget,
    backendNodeId: number,
    signal: AbortSignal,
  ): Promise<void> {
    const response = axTreeSchema.parse(await this.sendCommand(target, signal, "Accessibility.getPartialAXTree", {
      backendNodeId,
      fetchRelatives: false,
    }));
    const option = response.nodes.find((node) => node.backendDOMNodeId === backendNodeId) ?? response.nodes[0];
    if (option === undefined || propertyValue(option, "selected") !== true) {
      throw new Error("Browser automation select exact-value postcondition failed");
    }
  }

  private async viewport(target: AutomationTarget, signal: AbortSignal): Promise<{ height: number; width: number }> {
    const metrics = layoutMetricsSchema.parse(await this.sendCommand(target, signal, "Page.getLayoutMetrics"));
    return { height: metrics.cssLayoutViewport.clientHeight, width: metrics.cssLayoutViewport.clientWidth };
  }

  private async snapshot(target: AutomationTarget, signal: AbortSignal): Promise<BrowserAutomationCommandResult & { kind: "snapshot" }> {
    const navigationEpoch = target.navigationEpoch;
    const previousGeneration = target.generation;
    const generation = previousGeneration + 1;
    const response = axTreeSchema.parse(await this.sendCommand(target, signal, "Accessibility.getFullAXTree", { depth: MAX_AX_DEPTH }));
    if (target.navigationEpoch !== navigationEpoch || target.generation !== previousGeneration) throw new DesktopBrowserAutomationError("stale_revision", "Browser automation snapshot became stale during collection");
    const included = response.nodes.filter((node) => !node.ignored).slice(0, MAX_AX_NODES);
    const byId = new Map(included.map((node) => [node.nodeId, node]));
    const childIds = new Set(included.flatMap((node) => node.childIds ?? []));
    const boundsByBackendNodeId = new Map<number, BrowserAutomationSnapshotNode["bounds"]>();
    const viewport = await this.viewport(target, signal);
    for (let offset = 0; offset < included.length; offset += 20) {
      await Promise.all(included.slice(offset, offset + 20).map(async (node) => {
        if (node.backendDOMNodeId === undefined) return;
        try {
          const box = boxModelSchema.parse(await this.sendCommand(target, signal, "DOM.getBoxModel", { backendNodeId: node.backendDOMNodeId }));
          const points = quadPoints(box.model.content);
          const minX = Math.min(...points.map((point) => point.x));
          const maxX = Math.max(...points.map((point) => point.x));
          const minY = Math.min(...points.map((point) => point.y));
          const maxY = Math.max(...points.map((point) => point.y));
          boundsByBackendNodeId.set(node.backendDOMNodeId, { x: minX, y: minY, width: maxX - minX, height: maxY - minY });
        } catch (error) {
          if (signal.aborted) throw error;
        }
      }));
      if (target.navigationEpoch !== navigationEpoch || target.generation !== previousGeneration) throw new DesktopBrowserAutomationError("stale_revision", "Browser automation snapshot became stale during collection");
    }
    const nextRefs = new Map<string, number>();
    let refNumber = 0;
    let emittedNodes = 0;
    const visitedNodeIds = new Set<string>();
    const build = (node: z.infer<typeof axNodeSchema>, depth: number): BrowserAutomationSnapshotNode | null => {
      if (emittedNodes >= MAX_AX_NODES || visitedNodeIds.has(node.nodeId)) return null;
      emittedNodes += 1;
      visitedNodeIds.add(node.nodeId);
      const backendNodeId = node.backendDOMNodeId;
      const ref = backendNodeId === undefined ? undefined : formatBrowserSnapshotRef({ navigationEpoch, snapshotGeneration: generation, refNumber: ++refNumber });
      if (ref !== undefined && backendNodeId !== undefined) nextRefs.set(ref, backendNodeId);
      const bounds = backendNodeId === undefined ? undefined : boundsByBackendNodeId.get(backendNodeId);
      const checked = propertyValue(node, "checked");
      const disabled = propertyValue(node, "disabled");
      const expanded = propertyValue(node, "expanded");
      const href = propertyValue(node, "url");
      const selected = propertyValue(node, "selected");
      const children: BrowserAutomationSnapshotNode[] = [];
      if (depth < MAX_AX_DEPTH) {
        for (const childId of node.childIds ?? []) {
          const child = byId.get(childId);
          if (child === undefined) continue;
          const builtChild = build(child, depth + 1);
          if (builtChild !== null) children.push(builtChild);
        }
      }
      const clipped = bounds === undefined ? [] : clipPolygon([
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height },
      ], viewport.width, viewport.height);
      return {
        ...(bounds === undefined ? {} : { bounds }),
        ...(checked === undefined ? {} : { checked: Boolean(checked) }),
        children,
        ...(disabled === undefined ? {} : { disabled: Boolean(disabled) }),
        ...(expanded === undefined ? {} : { expanded: Boolean(expanded) }),
        ...(typeof href === "string" ? { href: href.slice(0, 4096) } : {}),
        name: textValue(node.name),
        ...(ref === undefined ? {} : { ref }),
        role: textValue(node.role),
        ...(selected === undefined ? {} : { selected: Boolean(selected) }),
        ...(node.value === undefined ? {} : { value: textValue(node.value) }),
        visible: clipped.length > 0 && bounds !== undefined && bounds.height > 0 && bounds.width > 0,
      };
    };
    const roots: BrowserAutomationSnapshotNode[] = [];
    for (const node of included.filter((candidate) => !childIds.has(candidate.nodeId))) {
      const root = build(node, 1);
      if (root !== null) roots.push(root);
    }
    assertActive(signal);
    if (target.navigationEpoch !== navigationEpoch || target.generation !== previousGeneration) throw new DesktopBrowserAutomationError("stale_revision", "Browser automation snapshot became stale during collection");
    target.generation = generation;
    target.refs = nextRefs;
    return { kind: "snapshot", generation, nodes: roots, navigationEpoch, ready: !target.webContents.isLoadingMainFrame(), url: target.webContents.getURL() };
  }
}
