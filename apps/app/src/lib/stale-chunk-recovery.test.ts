// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installStaleChunkRecovery } from "./stale-chunk-recovery";
import { getPromptDraftAccessor } from "../hooks/usePromptDraftStorage";

const LOADED_ENTRY = "/assets/index-old.js";
const downloadError = () =>
  new TypeError("Failed to fetch dynamically imported module: /assets/old.js");
const reload = vi.fn();
const fetchIndex = vi.fn<typeof fetch>();
let loadedScript: HTMLScriptElement;
let dispose: () => void;

function entryUrl(path: string) {
  return new URL(path, document.baseURI).href;
}

function indexHtml(entry: string | null) {
  const script =
    entry === null
      ? ""
      : `<script type="module" crossorigin src="${entry}"></script>`;
  return `<!doctype html><html><head><script>window.theme = 1;</script>${script}</head><body></body></html>`;
}

function deploy(entry: string | null, init?: ResponseInit) {
  fetchIndex.mockImplementation(
    async () => new Response(indexHtml(entry), init),
  );
}

function failImport(error: unknown = downloadError()) {
  window.dispatchEvent(
    Object.assign(new Event("vite:preloadError"), { payload: error }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
  loadedScript = document.createElement("script");
  loadedScript.type = "module";
  loadedScript.setAttribute("src", LOADED_ENTRY);
  document.head.append(loadedScript);
  vi.stubGlobal("window", {
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    dispatchEvent: window.dispatchEvent.bind(window),
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    location: { reload },
  });
  vi.stubGlobal("fetch", fetchIndex);
  fetchIndex.mockReset();
  deploy(LOADED_ENTRY);
  reload.mockReset();
  dispose = installStaleChunkRecovery();
});

afterEach(() => {
  dispose();
  loadedScript.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

it("reloads once after a deployment, persists the latest composer edit before navigation, and restores it with fresh module state", async () => {
  deploy("/assets/index-new.js");
  const draft = getPromptDraftAccessor({ kind: "new-thread" });
  draft.setTextAndMentions("Unsent edit just before the chunk failed", []);
  expect(window.localStorage.getItem(draft.storageKey)).toBeNull();
  let persistedAtReload: string | null = null;
  let guardAtReload: string | null = null;
  reload.mockImplementation(() => {
    persistedAtReload = window.localStorage.getItem(draft.storageKey);
    guardAtReload = window.sessionStorage.getItem("bb.stale-chunk-reload");
  });
  failImport();
  failImport();
  await settle();
  expect(fetchIndex).toHaveBeenCalledOnce();
  expect(fetchIndex).toHaveBeenCalledWith(
    "/",
    expect.objectContaining({ cache: "no-store" }),
  );
  expect(reload).toHaveBeenCalledOnce();
  expect(JSON.parse(persistedAtReload ?? "null")).toMatchObject({
    text: "Unsent edit just before the chunk failed",
  });
  expect(guardAtReload).toBe(entryUrl("/assets/index-new.js"));
  failImport();
  await settle();
  expect(reload).toHaveBeenCalledOnce();
  vi.resetModules();
  const { getPromptDraftAccessor: restoredAccessor } =
    await import("../hooks/usePromptDraftStorage");
  expect(restoredAccessor({ kind: "new-thread" }).getCurrent().text).toBe(
    "Unsent edit just before the chunk failed",
  );
});

it("does not reload again when the reload still serves the stale document, and permits a later deployment", async () => {
  deploy("/assets/index-new.js");
  failImport();
  await settle();
  expect(reload).toHaveBeenCalledOnce();
  dispose();
  dispose = installStaleChunkRecovery();
  failImport();
  await settle();
  expect(reload).toHaveBeenCalledOnce();
  deploy("/assets/index-newer.js");
  failImport();
  await settle();
  expect(reload).toHaveBeenCalledTimes(2);
});

it.each([
  new Error("Unable to preload CSS for /assets/old.css"),
  new SyntaxError("Unexpected token"),
  new Error("render failed"),
  new TypeError("Failed to fetch"),
  "Failed to fetch dynamically imported module: /assets/old.js",
])(
  "does not contact the server for evaluation, CSS, render, or unrelated network errors: %s",
  async (error) => {
    deploy("/assets/index-new.js");
    failImport(error);
    window.dispatchEvent(new Event("error"));
    await settle();
    expect(fetchIndex).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  },
);

it.each([
  "same deployment",
  "offline",
  "error response",
  "no entry script",
  "storage read fails",
  "storage write fails",
  "draft write fails",
])("leaves the error visible when %s", async (failure) => {
  deploy("/assets/index-new.js");
  if (failure === "same deployment") deploy(LOADED_ENTRY);
  if (failure === "offline")
    fetchIndex.mockRejectedValue(new TypeError("offline"));
  if (failure === "error response")
    deploy("/assets/index-new.js", { status: 502 });
  if (failure === "no entry script") deploy(null);
  if (failure === "storage read fails")
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
  if (failure === "storage write fails")
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
  if (failure === "draft write fails") {
    getPromptDraftAccessor({
      kind: "thread",
      projectId: "p",
      threadId: "t",
    }).setTextAndMentions("do not lose this", []);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  }
  const event = Object.assign(
    new Event("vite:preloadError", { cancelable: true }),
    { payload: downloadError() },
  );
  window.dispatchEvent(event);
  await settle();
  expect(reload).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
  failImport();
  await settle();
  expect(reload).not.toHaveBeenCalled();
});
