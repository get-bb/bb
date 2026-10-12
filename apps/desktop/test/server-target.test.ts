import { describe, expect, it } from "vitest";
import {
  builtinServerName,
  BUILTIN_SERVER_NAME,
  createServerTargetStore,
  normalizeCustomServerUrl,
  type ConnectServerRef,
  type ServerTargetFs,
} from "../src/server-target.js";

const STORAGE_PATH = "/tmp/t.json";

const LAPTOP: ConnectServerRef = {
  handle: "laptop",
  name: "Laptop",
  url: "https://laptop.getbb.app",
};

const STUDIO: ConnectServerRef = {
  handle: "studio",
  name: "Studio",
  url: "https://studio.getbb.app",
};

describe("builtinServerName", () => {
  it("uses the operating system's local server label", () => {
    expect(builtinServerName("darwin")).toBe("This Mac");
    expect(builtinServerName("linux")).toBe("This Computer");
    expect(BUILTIN_SERVER_NAME).toBe(builtinServerName(process.platform));
  });
});

function createMemoryFs(initial: Record<string, string> = {}): {
  files: Map<string, string>;
  fs: ServerTargetFs;
  writes: () => number;
} {
  const files = new Map(Object.entries(initial));
  let writeCount = 0;
  return {
    files,
    fs: {
      async mkdir() {
        return undefined;
      },
      async readFile(path) {
        const content = files.get(path);
        if (content === undefined) {
          throw new Error(`ENOENT: ${path}`);
        }
        return content;
      },
      async writeFile(path, data) {
        writeCount += 1;
        files.set(path, data);
      },
    },
    writes: () => writeCount,
  };
}

async function loadStore(initial: Record<string, unknown> | null = null) {
  const memory = createMemoryFs(
    initial === null ? {} : { [STORAGE_PATH]: JSON.stringify(initial) },
  );
  const store = createServerTargetStore({
    fs: memory.fs,
    storagePath: STORAGE_PATH,
  });
  await store.load();
  const reload = async () => {
    const reloaded = createServerTargetStore({
      fs: memory.fs,
      storagePath: STORAGE_PATH,
    });
    await reloaded.load();
    return reloaded;
  };
  const savedFile = (): unknown =>
    JSON.parse(memory.files.get(STORAGE_PATH) ?? "null");
  return { ...memory, reload, savedFile, store };
}

describe("normalizeCustomServerUrl", () => {
  it("trims, strips hashes and trailing slashes, rejects non-http", () => {
    expect(normalizeCustomServerUrl(" https://example.com/ ")).toBe(
      "https://example.com",
    );
    expect(normalizeCustomServerUrl("http://10.0.0.5:38886/#x")).toBe(
      "http://10.0.0.5:38886",
    );
    expect(normalizeCustomServerUrl("")).toBeNull();
    expect(normalizeCustomServerUrl("example.com")).toBeNull();
    expect(normalizeCustomServerUrl("file:///etc/passwd")).toBeNull();
  });
});

describe("server target store", () => {
  it("defaults to builtin without window targets when no file exists", async () => {
    const { store } = await loadStore();
    expect(store.getDefaultTarget()).toEqual({ kind: "builtin" });
    expect(store.getWindowTarget("main")).toBeNull();
    expect(store.getCustomServerUrls()).toEqual([]);
    expect(store.listReferencedConnectServers()).toEqual([]);
  });

  it.each([
    {
      name: "a custom target",
      file: {
        customServerUrl: "https://old.example/",
        customServerUrls: ["https://other.example"],
        target: "custom",
      },
      target: { kind: "custom", url: "https://old.example" },
      urls: ["https://other.example", "https://old.example"],
      connect: [],
    },
    {
      name: "a Connect target",
      file: {
        connectServer: LAPTOP,
        customServerUrl: null,
        target: "connect",
      },
      target: { kind: "connect", server: LAPTOP },
      urls: [],
      connect: [LAPTOP],
    },
    {
      name: "a builtin target with a remembered Connect server",
      file: {
        connectServer: LAPTOP,
        customServerUrl: "https://old.example",
        target: "builtin",
      },
      target: { kind: "builtin" },
      urls: ["https://old.example"],
      connect: [LAPTOP],
    },
  ])(
    "migrates the single target of an older build with $name to the default for new windows",
    async ({ file, target, urls, connect }) => {
      const { store } = await loadStore(file);
      expect(store.getDefaultTarget()).toEqual(target);
      expect(store.getWindowTarget("main")).toBeNull();
      expect(store.getCustomServerUrls()).toEqual(urls);
      expect(store.listReferencedConnectServers()).toEqual(connect);
    },
  );

  it("restores each window's server and keeps the fields older builds read", async () => {
    const { reload, savedFile, store } = await loadStore();
    await store.setDefaultTarget({
      kind: "custom",
      url: "https://first.example",
    });
    await store.setWindowTarget("main", { kind: "builtin" });
    await store.setWindowTarget("window-a", {
      kind: "custom",
      url: "https://second.example",
    });
    await store.setWindowTarget("window-b", {
      kind: "connect",
      server: LAPTOP,
    });

    const reloaded = await reload();
    expect(reloaded.getDefaultTarget()).toEqual({
      kind: "custom",
      url: "https://first.example",
    });
    expect(reloaded.getWindowTarget("main")).toEqual({ kind: "builtin" });
    expect(reloaded.getWindowTarget("window-a")).toEqual({
      kind: "custom",
      url: "https://second.example",
    });
    expect(reloaded.getWindowTarget("window-b")).toEqual({
      kind: "connect",
      server: LAPTOP,
    });
    expect(reloaded.getCustomServerUrls()).toEqual([
      "https://first.example",
      "https://second.example",
    ]);
    expect(savedFile()).toMatchObject({
      connectServer: LAPTOP,
      customServerUrl: "https://first.example",
      customServerUrls: ["https://first.example", "https://second.example"],
      target: "custom",
    });
  });

  it("writes the default's Connect server for older builds when the default is Connect", async () => {
    const { savedFile, store } = await loadStore();
    await store.setDefaultTarget({ kind: "connect", server: LAPTOP });
    await store.setWindowTarget("window-a", {
      kind: "connect",
      server: STUDIO,
    });
    expect(savedFile()).toMatchObject({
      connectServer: LAPTOP,
      customServerUrl: null,
      target: "connect",
    });
  });

  it("drops a damaged window target without losing the other servers", async () => {
    const { store } = await loadStore({
      customServerUrl: null,
      customServerUrls: ["https://saved.example"],
      target: "builtin",
      windowTargets: {
        main: { kind: "builtin" },
        "window-bad-url": { kind: "custom", url: "not-a-url" },
        "window-future": { kind: "future" },
        "window-number": 42,
        "": { kind: "builtin" },
        "window-unsaved": { kind: "custom", url: "https://unsaved.example/" },
      },
    });
    expect(store.getWindowTarget("main")).toEqual({ kind: "builtin" });
    expect(store.getWindowTarget("window-bad-url")).toBeNull();
    expect(store.getWindowTarget("window-future")).toBeNull();
    expect(store.getWindowTarget("window-number")).toBeNull();
    expect(store.getWindowTarget("")).toBeNull();
    expect(store.getWindowTarget("window-unsaved")).toEqual({
      kind: "custom",
      url: "https://unsaved.example",
    });
    expect(store.getCustomServerUrls()).toEqual([
      "https://saved.example",
      "https://unsaved.example",
    ]);

    const { store: unreadable } = await loadStore({
      customServerUrl: "https://saved.example",
      target: "custom",
      windowTargets: "not-an-object",
    });
    expect(unreadable.getDefaultTarget()).toEqual({
      kind: "custom",
      url: "https://saved.example",
    });
    expect(unreadable.getWindowTarget("main")).toBeNull();
  });

  it("edits a custom server in the list, the default, and only the windows on it", async () => {
    const { reload, store } = await loadStore();
    await store.addCustomServerUrl("https://first.example");
    await store.addCustomServerUrl("https://second.example");
    await store.setDefaultTarget({
      kind: "custom",
      url: "https://first.example",
    });
    await store.setWindowTarget("main", {
      kind: "custom",
      url: "https://first.example",
    });
    await store.setWindowTarget("window-a", {
      kind: "custom",
      url: "https://first.example",
    });
    await store.setWindowTarget("window-b", {
      kind: "custom",
      url: "https://second.example",
    });

    await expect(
      store.replaceCustomServerUrl(
        "https://first.example",
        "https://edited.example/",
      ),
    ).resolves.toEqual(["main", "window-a"]);

    const reloaded = await reload();
    expect(reloaded.getCustomServerUrls()).toEqual([
      "https://edited.example",
      "https://second.example",
    ]);
    expect(reloaded.getDefaultTarget()).toEqual({
      kind: "custom",
      url: "https://edited.example",
    });
    expect(reloaded.getWindowTarget("window-a")).toEqual({
      kind: "custom",
      url: "https://edited.example",
    });
    expect(reloaded.getWindowTarget("window-b")).toEqual({
      kind: "custom",
      url: "https://second.example",
    });
  });

  it("merges an edited custom server into an identical saved one", async () => {
    const { store } = await loadStore();
    await store.addCustomServerUrl("https://first.example");
    await store.addCustomServerUrl("https://second.example");
    await store.replaceCustomServerUrl(
      "https://first.example",
      "https://second.example",
    );
    expect(store.getCustomServerUrls()).toEqual(["https://second.example"]);
  });

  it("removes a custom server and moves its windows and the default to builtin", async () => {
    const { reload, store } = await loadStore();
    await store.setDefaultTarget({
      kind: "custom",
      url: "https://gone.example",
    });
    await store.setWindowTarget("main", {
      kind: "custom",
      url: "https://gone.example",
    });
    await store.setWindowTarget("window-a", {
      kind: "custom",
      url: "https://kept.example",
    });

    await expect(
      store.removeCustomServerUrl("https://gone.example"),
    ).resolves.toEqual(["main"]);

    const reloaded = await reload();
    expect(reloaded.getCustomServerUrls()).toEqual(["https://kept.example"]);
    expect(reloaded.getDefaultTarget()).toEqual({ kind: "builtin" });
    expect(reloaded.getWindowTarget("main")).toEqual({ kind: "builtin" });
    expect(reloaded.getWindowTarget("window-a")).toEqual({
      kind: "custom",
      url: "https://kept.example",
    });
  });

  it("moves only builtin windows and a builtin default to a moved server", async () => {
    const { store } = await loadStore();
    await store.setWindowTarget("main", { kind: "builtin" });
    await store.setWindowTarget("window-a", {
      kind: "connect",
      server: LAPTOP,
    });
    await store.setWindowTarget("window-b", { kind: "builtin" });

    await expect(
      store.retargetBuiltin({
        kind: "custom",
        url: "https://studio.tailnet.ts.net:38886",
      }),
    ).resolves.toEqual(["main", "window-b"]);

    const moved = {
      kind: "custom",
      url: "https://studio.tailnet.ts.net:38886",
    };
    expect(store.getDefaultTarget()).toEqual(moved);
    expect(store.getWindowTarget("main")).toEqual(moved);
    expect(store.getWindowTarget("window-b")).toEqual(moved);
    expect(store.getWindowTarget("window-a")).toEqual({
      kind: "connect",
      server: LAPTOP,
    });
    expect(store.getCustomServerUrls()).toEqual([
      "https://studio.tailnet.ts.net:38886",
    ]);
  });

  it("refreshes every reference to a renamed Connect server", async () => {
    const { reload, store } = await loadStore();
    await store.setWindowTarget("window-a", {
      kind: "connect",
      server: LAPTOP,
    });
    await store.setDefaultTarget({ kind: "connect", server: LAPTOP });
    await store.setWindowTarget("window-b", {
      kind: "connect",
      server: STUDIO,
    });
    const renamed = {
      handle: "laptop",
      name: "Laptop Renamed",
      url: "https://laptop-new.getbb.app",
    };

    await expect(store.refreshConnectServer(renamed)).resolves.toBe(true);
    await expect(store.refreshConnectServer(renamed)).resolves.toBe(false);
    await expect(
      store.refreshConnectServer({ ...STUDIO, handle: "unknown" }),
    ).resolves.toBe(false);

    const reloaded = await reload();
    expect(reloaded.getDefaultTarget()).toEqual({
      kind: "connect",
      server: renamed,
    });
    expect(reloaded.getWindowTarget("window-a")).toEqual({
      kind: "connect",
      server: renamed,
    });
    expect(reloaded.getWindowTarget("window-b")).toEqual({
      kind: "connect",
      server: STUDIO,
    });
  });

  it("keeps listing the last Connect server after every window leaves it", async () => {
    const { store } = await loadStore();
    await store.setWindowTarget("main", { kind: "connect", server: LAPTOP });
    await store.setWindowTarget("window-a", {
      kind: "connect",
      server: STUDIO,
    });
    await store.setWindowTarget("main", { kind: "builtin" });
    await store.setWindowTarget("window-a", { kind: "builtin" });

    expect(store.listReferencedConnectServers()).toEqual([STUDIO]);
  });

  it("does not rewrite the file when a target is unchanged", async () => {
    const { store, writes } = await loadStore();
    await store.setDefaultTarget({ kind: "connect", server: LAPTOP });
    await store.setWindowTarget("main", { kind: "connect", server: LAPTOP });
    const before = writes();

    await store.setDefaultTarget({ kind: "connect", server: { ...LAPTOP } });
    await store.setWindowTarget("main", {
      kind: "connect",
      server: { ...LAPTOP },
    });
    await store.removeWindowTarget("window-missing");
    await store.pruneWindowTargets(new Set(["main"]));

    expect(writes()).toBe(before);
  });

  it("forgets the servers of windows that were closed or are no longer saved", async () => {
    const { reload, store } = await loadStore();
    await store.setWindowTarget("main", { kind: "builtin" });
    await store.setWindowTarget("window-closed", { kind: "builtin" });
    await store.setWindowTarget("window-stale", { kind: "builtin" });

    await store.removeWindowTarget("window-closed");
    await store.pruneWindowTargets(new Set(["main"]));

    const reloaded = await reload();
    expect(reloaded.getWindowTarget("main")).toEqual({ kind: "builtin" });
    expect(reloaded.getWindowTarget("window-closed")).toBeNull();
    expect(reloaded.getWindowTarget("window-stale")).toBeNull();
  });

  it("rejects invalid custom URLs without changing the saved list", async () => {
    const { store } = await loadStore();
    await expect(
      store.addCustomServerUrl(" https://ok.example/ "),
    ).resolves.toBe("https://ok.example");
    await expect(store.addCustomServerUrl("file:///bad")).rejects.toThrow(
      "valid http(s) URL",
    );
    await expect(
      store.replaceCustomServerUrl("https://ok.example", "not a url"),
    ).rejects.toThrow("valid http(s) URL");
    expect(store.getCustomServerUrls()).toEqual(["https://ok.example"]);
  });

  it("falls back to builtin when the persisted file is corrupt or dangling", async () => {
    const corrupt = createServerTargetStore({
      fs: createMemoryFs({ [STORAGE_PATH]: "{not json" }).fs,
      storagePath: STORAGE_PATH,
    });
    await corrupt.load();
    expect(corrupt.getDefaultTarget()).toEqual({ kind: "builtin" });

    const { store: dangling } = await loadStore({
      customServerUrl: null,
      target: "custom",
    });
    expect(dangling.getDefaultTarget()).toEqual({ kind: "builtin" });

    const { store: danglingConnect } = await loadStore({
      connectServer: null,
      customServerUrl: null,
      target: "connect",
    });
    expect(danglingConnect.getDefaultTarget()).toEqual({ kind: "builtin" });

    const { store: invalidUrl } = await loadStore({
      customServerUrl: "not-a-url",
      target: "custom",
    });
    expect(invalidUrl.getDefaultTarget()).toEqual({ kind: "builtin" });
    expect(invalidUrl.getCustomServerUrls()).toEqual([]);
  });
});
