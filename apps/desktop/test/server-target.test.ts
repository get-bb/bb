import { describe, expect, it } from "vitest";
import {
  createServerTargetStore,
  normalizeCustomServerUrl,
  type ServerTargetFs,
  type ServerTargetStore,
} from "../src/server-target.js";

const STORAGE_PATH = "/tmp/t.json";

function createMemoryFs(initial: Record<string, string> = {}): {
  files: Map<string, string>;
  fs: ServerTargetFs;
} {
  const files = new Map(Object.entries(initial));
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
        files.set(path, data);
      },
    },
  };
}

function createStore(fs: ServerTargetFs): ServerTargetStore {
  let nextId = 0;
  return createServerTargetStore({
    createId: () => {
      nextId += 1;
      return `id-${nextId}`;
    },
    fs,
    storagePath: STORAGE_PATH,
  });
}

async function loadedStore(fs: ServerTargetFs): Promise<ServerTargetStore> {
  const store = createStore(fs);
  await store.load();
  return store;
}

function readPersisted(files: Map<string, string>): unknown {
  const raw = files.get(STORAGE_PATH);
  if (raw === undefined) {
    throw new Error("nothing persisted");
  }
  return JSON.parse(raw);
}

const LAPTOP = {
  handle: "laptop",
  name: "Laptop",
  url: "https://laptop.getbb.app",
};

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

describe("server target store v1 migration", () => {
  it("moves a v1 custom URL into the list and keeps it selected", async () => {
    const { files, fs } = createMemoryFs({
      [STORAGE_PATH]: JSON.stringify({
        connectServer: LAPTOP,
        customServerUrl: "https://example.com:38886/",
        target: "custom",
      }),
    });
    const store = await loadedStore(fs);

    expect(store.getCustomServers()).toEqual([
      {
        id: "id-1",
        name: "example.com:38886",
        url: "https://example.com:38886",
      },
    ]);
    expect(store.getTarget()).toEqual({
      kind: "custom",
      server: {
        id: "id-1",
        name: "example.com:38886",
        url: "https://example.com:38886",
      },
    });
    expect(store.getConnectTrusted()).toBe(true);
    expect(store.getConnectServer()).toEqual(LAPTOP);

    await store.setConnectTrusted(false);
    expect(readPersisted(files)).toEqual({
      connectServer: LAPTOP,
      connectTrusted: false,
      customServers: [
        {
          id: "id-1",
          name: "example.com:38886",
          url: "https://example.com:38886",
        },
      ],
      selectedServerId: "id-1",
      version: 2,
    });
  });

  it("maps a v1 connect target onto a connect server id", async () => {
    const { fs } = createMemoryFs({
      [STORAGE_PATH]: JSON.stringify({
        connectServer: LAPTOP,
        customServerUrl: null,
        target: "connect",
      }),
    });
    const store = await loadedStore(fs);
    expect(store.getSelectedServerId()).toBe("connect:laptop");
    expect(store.getTarget()).toEqual({ kind: "connect", server: LAPTOP });
  });

  it("drops a v1 selection that no longer resolves", async () => {
    const { fs } = createMemoryFs({
      [STORAGE_PATH]: JSON.stringify({
        customServerUrl: "not-a-url",
        target: "custom",
      }),
    });
    const store = await loadedStore(fs);
    expect(store.getCustomServers()).toEqual([]);
    expect(store.getSelectedServerId()).toBeNull();
    expect(store.getTarget()).toEqual({ kind: "builtin" });
  });
});

describe("server target store", () => {
  it("defaults to builtin with bb Connect trusted", async () => {
    const { fs } = createMemoryFs();
    const store = await loadedStore(fs);
    expect(store.getTarget()).toEqual({ kind: "builtin" });
    expect(store.getCustomServers()).toEqual([]);
    expect(store.getConnectTrusted()).toBe(true);
  });

  it("adds, selects, and round-trips custom servers through load", async () => {
    const { fs } = createMemoryFs();
    const store = await loadedStore(fs);

    const added = await store.addCustomServer(
      "  Office  ",
      " https://a.test/ ",
    );
    expect(added).toEqual({
      id: "id-1",
      name: "Office",
      url: "https://a.test",
    });
    expect(store.getTarget()).toEqual({ kind: "builtin" });

    const unnamed = await store.addCustomServer("", "http://10.0.0.5:38886");
    expect(unnamed?.name).toBe("10.0.0.5:38886");

    expect(await store.setSelectedServerId("id-2")).toBe(true);
    expect(store.getTarget()).toEqual({
      kind: "custom",
      server: {
        id: "id-2",
        name: "10.0.0.5:38886",
        url: "http://10.0.0.5:38886",
      },
    });

    const reloaded = await loadedStore(fs);
    expect(reloaded.getCustomServers()).toHaveLength(2);
    expect(reloaded.getSelectedServerId()).toBe("id-2");
  });

  it("rejects an invalid custom URL and reuses an existing entry", async () => {
    const { fs } = createMemoryFs();
    const store = await loadedStore(fs);
    expect(await store.addCustomServer("Bad", "not-a-url")).toBeNull();
    expect(await store.addCustomServer("Bad", "file:///etc/passwd")).toBeNull();

    const first = await store.addCustomServer("First", "https://a.test");
    const duplicate = await store.addCustomServer("Second", "https://a.test/");
    expect(duplicate).toEqual(first);
    expect(store.getCustomServers()).toHaveLength(1);
  });

  it("falls back to builtin when the selected custom server is removed", async () => {
    const { fs } = createMemoryFs();
    const store = await loadedStore(fs);
    await store.addCustomServer("Office", "https://a.test");
    await store.addCustomServer("Other", "https://b.test");
    await store.setSelectedServerId("id-1");

    expect(await store.removeCustomServer("id-1")).toBe(true);
    expect(store.getTarget()).toEqual({ kind: "builtin" });
    expect(store.getSelectedServerId()).toBeNull();
    expect(store.getCustomServers().map((server) => server.id)).toEqual([
      "id-2",
    ]);
    expect(await store.removeCustomServer("id-1")).toBe(false);

    const reloaded = await loadedStore(fs);
    expect(reloaded.getCustomServers().map((server) => server.id)).toEqual([
      "id-2",
    ]);
  });

  it("refuses to select an unknown or untrusted server id", async () => {
    const { fs } = createMemoryFs();
    const store = await loadedStore(fs);
    expect(await store.setSelectedServerId("id-1")).toBe(false);
    expect(await store.setSelectedServerId("connect:laptop")).toBe(false);
    expect(await store.setSelectedServerId("builtin")).toBe(true);
    expect(store.getSelectedServerId()).toBeNull();

    await store.setConnectServer(LAPTOP);
    await store.setConnectTrusted(false);
    expect(await store.setSelectedServerId("connect:laptop")).toBe(false);
  });

  it("selects, persists, and refreshes a connect server target", async () => {
    const { fs } = createMemoryFs();
    const store = await loadedStore(fs);

    await store.setConnectServer(LAPTOP);
    expect(store.getTarget()).toEqual({ kind: "connect", server: LAPTOP });

    expect(await store.setSelectedServerId("builtin")).toBe(true);
    expect(
      await store.refreshConnectServer({
        handle: "laptop",
        name: "Laptop Renamed",
        url: "https://laptop-new.getbb.app",
      }),
    ).toBe(true);
    expect(
      await store.refreshConnectServer({
        handle: "unknown",
        name: "Nope",
        url: "https://nope.getbb.app",
      }),
    ).toBe(false);

    const reloaded = await loadedStore(fs);
    expect(reloaded.getTarget()).toEqual({ kind: "builtin" });
    expect(reloaded.getConnectServer()?.name).toBe("Laptop Renamed");
  });

  it("drops a connect selection when bb Connect stops being trusted", async () => {
    const { fs } = createMemoryFs();
    const store = await loadedStore(fs);
    await store.setConnectServer(LAPTOP);

    await store.setConnectTrusted(false);
    expect(store.getConnectTrusted()).toBe(false);
    expect(store.getSelectedServerId()).toBeNull();
    expect(store.getTarget()).toEqual({ kind: "builtin" });

    await store.setConnectTrusted(true);
    expect(store.getTarget()).toEqual({ kind: "builtin" });
    expect(store.getConnectServer()).toEqual(LAPTOP);
  });

  it("hides a connect target loaded from disk while bb Connect is untrusted", async () => {
    const { fs } = createMemoryFs({
      [STORAGE_PATH]: JSON.stringify({
        connectServer: LAPTOP,
        connectTrusted: false,
        customServers: [],
        selectedServerId: "connect:laptop",
        version: 2,
      }),
    });
    const store = await loadedStore(fs);
    expect(store.getTarget()).toEqual({ kind: "builtin" });
    expect(store.getSelectedServerId()).toBeNull();
  });

  it("falls back to builtin when the persisted file is corrupt or dangling", async () => {
    const corrupt = await loadedStore(
      createMemoryFs({ [STORAGE_PATH]: "{not json" }).fs,
    );
    expect(corrupt.getTarget()).toEqual({ kind: "builtin" });

    const dangling = await loadedStore(
      createMemoryFs({
        [STORAGE_PATH]: JSON.stringify({
          connectServer: null,
          connectTrusted: true,
          customServers: [],
          selectedServerId: "id-missing",
          version: 2,
        }),
      }).fs,
    );
    expect(dangling.getTarget()).toEqual({ kind: "builtin" });
    expect(dangling.getSelectedServerId()).toBeNull();

    const invalidUrl = await loadedStore(
      createMemoryFs({
        [STORAGE_PATH]: JSON.stringify({
          connectServer: null,
          connectTrusted: true,
          customServers: [{ id: "id-1", name: "Bad", url: "not-a-url" }],
          selectedServerId: "id-1",
          version: 2,
        }),
      }).fs,
    );
    expect(invalidUrl.getCustomServers()).toEqual([]);
    expect(invalidUrl.getTarget()).toEqual({ kind: "builtin" });
  });
});
