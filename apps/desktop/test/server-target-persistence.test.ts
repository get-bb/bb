import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { expect, it, onTestFinished } from "vitest";
import {
  createServerTargetStore,
  SERVER_TARGET_FILE_NAME,
  type ServerTargetFs,
} from "../src/server-target.js";

async function createStoragePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "bb-server-target-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return join(directory, SERVER_TARGET_FILE_NAME);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const firstUrl = "http://localhost:4001";
const secondUrl = "http://localhost:4002";
const thirdUrl = "http://localhost:4003";
const connectServer = {
  handle: "laptop",
  name: "Laptop",
  url: "https://laptop.getbb.app",
};

it.each([
  {
    name: "legacy settings without a saved list",
    settings: { customServerUrl: firstUrl, target: "custom" },
    urls: [firstUrl, thirdUrl],
    connect: null,
  },
  {
    name: "unknown top-level settings",
    settings: {
      customServerUrl: firstUrl,
      customServerUrls: [firstUrl, secondUrl],
      target: "custom",
      futureSetting: true,
    },
    urls: [firstUrl, secondUrl, thirdUrl],
    connect: null,
  },
  {
    name: "unknown connect-server settings",
    settings: {
      connectServer: { ...connectServer, futureSetting: true },
      customServerUrl: firstUrl,
      customServerUrls: [firstUrl, secondUrl],
      target: "connect",
    },
    urls: [firstUrl, secondUrl, thirdUrl],
    connect: connectServer,
  },
])(
  "preserves saved servers from $name when adding a server",
  async ({ settings, urls, connect }) => {
    const storagePath = await createStoragePath();
    await writeFile(storagePath, JSON.stringify(settings), "utf8");
    const store = createServerTargetStore({ storagePath });
    await store.load();
    expect(store.getTarget()).toEqual(
      connect === null
        ? { kind: "custom", url: firstUrl }
        : { kind: "connect", server: connect },
    );
    await store.setCustomServerUrl(thirdUrl);
    expect(JSON.parse(await readFile(storagePath, "utf8"))).toEqual({
      ...("futureSetting" in settings ? { futureSetting: true } : {}),
      connectServer: connect,
      customServerUrl: thirdUrl,
      customServerUrls: urls,
      target: "custom",
    });
    const reloaded = createServerTargetStore({ storagePath });
    await reloaded.load();
    expect(reloaded.getCustomServerUrls()).toEqual(urls);
    expect(reloaded.getTarget()).toEqual({ kind: "custom", url: thirdUrl });
  },
);

it.each([
  { customServerUrls: [42] },
  { target: "future-target" },
  { connectServer: { ...connectServer, handle: 42 } },
])("still rejects malformed known settings: %j", async (invalid) => {
  const storagePath = await createStoragePath();
  await writeFile(
    storagePath,
    JSON.stringify({
      customServerUrl: firstUrl,
      customServerUrls: [firstUrl, secondUrl],
      target: "custom",
      ...invalid,
    }),
    "utf8",
  );
  const store = createServerTargetStore({ storagePath });
  await store.load();
  expect(store.getCustomServerUrls()).toEqual([]);
  expect(store.getTarget()).toEqual({ kind: "builtin" });
});

it.each(["none", "mkdir", "writeFile"] as const)(
  "keeps the newest overlapping save after a delayed write with %s failure",
  async (failure) => {
    const storagePath = await createStoragePath();
    const entered = deferred();
    const release = deferred();
    let delayed = false;
    const directoryOperations: Promise<string | undefined>[] = [];
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    const fs: ServerTargetFs = {
      async mkdir(path, options) {
        if (failure === "mkdir" && !delayed) {
          delayed = true;
          entered.resolve();
          await release.promise;
          throw new Error("mkdir failed");
        }
        const operation = mkdir(path, options);
        directoryOperations.push(operation);
        return operation;
      },
      readFile,
      async writeFile(path, data, encoding) {
        activeWrites += 1;
        maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
        try {
          if (!delayed) {
            delayed = true;
            entered.resolve();
            await release.promise;
            if (failure === "writeFile") {
              throw new Error("writeFile failed");
            }
          }
          await writeFile(path, data, encoding);
        } finally {
          activeWrites -= 1;
        }
      },
    };
    const store = createServerTargetStore({ storagePath, fs });
    await store.load();
    const first = store.setCustomServerUrl(firstUrl);
    const firstResult = Promise.allSettled([first]);
    await entered.promise;
    const second = store.setCustomServerUrl(secondUrl);
    const third = store.setTarget("builtin");
    const laterResults = Promise.allSettled([second, third]);
    try {
      await Promise.all(directoryOperations);
      await setImmediate();
    } finally {
      release.resolve();
    }
    expect(await firstResult).toEqual([
      failure === "none"
        ? { status: "fulfilled", value: undefined }
        : { status: "rejected", reason: new Error(`${failure} failed`) },
    ]);
    expect(await laterResults).toEqual([
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: true },
    ]);
    expect(maximumActiveWrites).toBe(1);
    const reloaded = createServerTargetStore({ storagePath });
    await reloaded.load();
    expect(reloaded.getCustomServerUrls()).toEqual([firstUrl, secondUrl]);
    expect(reloaded.getCustomServerUrl()).toBe(secondUrl);
    expect(reloaded.getTarget()).toEqual({ kind: "builtin" });
  },
);

it("keeps names through selection, restart, renaming, and clearing without changing the active target", async () => {
  const storagePath = await createStoragePath();
  await writeFile(
    storagePath,
    JSON.stringify({ customServerUrl: firstUrl, target: "custom" }),
    "utf8",
  );
  const store = createServerTargetStore({ storagePath });
  await store.load();
  expect(store.getCustomServers()).toEqual([{ url: firstUrl, name: null }]);
  await store.setCustomServerName(firstUrl, "  Office   Mac  ");
  await store.setCustomServerUrl(secondUrl, { name: "Lab" });
  await store.setCustomServerUrl(firstUrl);
  await store.setTarget("builtin");
  await store.setCustomServerName(firstUrl, "Renamed");
  expect(store.getTarget()).toEqual({ kind: "builtin" });
  const reloaded = createServerTargetStore({ storagePath });
  await reloaded.load();
  expect(reloaded.getCustomServers()).toEqual([
    { url: firstUrl, name: "Renamed" },
    { url: secondUrl, name: "Lab" },
  ]);
  expect(reloaded.getTarget()).toEqual({ kind: "builtin" });
  await reloaded.setCustomServerUrl(secondUrl);
  await reloaded.setCustomServerName(firstUrl, " ");
  expect(reloaded.getTarget()).toEqual({ kind: "custom", url: secondUrl });
  await reloaded.setCustomServerName(secondUrl, null);
  const final = createServerTargetStore({ storagePath });
  await final.load();
  expect(final.getCustomServers()).toEqual([
    { url: firstUrl, name: null },
    { url: secondUrl, name: null },
  ]);
  expect(final.getTarget()).toEqual({ kind: "custom", url: secondUrl });
  expect(JSON.parse(await readFile(storagePath, "utf8"))).toEqual({
    connectServer: null,
    customServerUrl: secondUrl,
    customServerUrls: [firstUrl, secondUrl],
    target: "custom",
  });
});

it("keeps URL edits in place and merges into the destination's name and position", async () => {
  const storagePath = await createStoragePath();
  const store = createServerTargetStore({ storagePath });
  await store.load();
  await store.setCustomServerUrl(firstUrl, { name: "First" });
  await store.setCustomServerUrl(secondUrl, { name: "Second" });
  await store.setCustomServerUrl(thirdUrl, { name: "Third" });
  const editedUrl = "http://localhost:4004";
  await store.setCustomServerUrl(editedUrl, { replacedUrl: firstUrl });
  expect(store.getCustomServers()).toEqual([
    { url: editedUrl, name: "First" },
    { url: secondUrl, name: "Second" },
    { url: thirdUrl, name: "Third" },
  ]);
  await store.setCustomServerUrl(`${thirdUrl}/#hash`, {
    replacedUrl: editedUrl,
    name: "Ignored on merge",
  });
  expect(store.getCustomServers()).toEqual([
    { url: secondUrl, name: "Second" },
    { url: thirdUrl, name: "Third" },
  ]);
  await store.setCustomServerUrl(thirdUrl, { name: "Added existing" });
  await store.setCustomServerUrl(thirdUrl);
  expect(store.getCustomServers()).toEqual([
    { url: secondUrl, name: "Second" },
    { url: thirdUrl, name: "Added existing" },
  ]);
  await store.setCustomServerUrl(null);
  const reloaded = createServerTargetStore({ storagePath });
  await reloaded.load();
  expect(reloaded.getCustomServers()).toEqual([
    { url: secondUrl, name: "Second" },
  ]);
  expect(reloaded.getTarget()).toEqual({ kind: "builtin" });
  expect(JSON.parse(await readFile(storagePath, "utf8"))).toMatchObject({
    customServerNames: { [secondUrl]: "Second" },
  });
});

it.each([
  { name: "invalid map", names: 42, expectedName: null },
  {
    name: "invalid names",
    names: { [firstUrl]: 42, [secondUrl]: "Dangling" },
    expectedName: null,
  },
  {
    name: "normalized names",
    names: { [`${firstUrl}/#hash`]: "  Office  Mac ", [secondUrl]: "Dangling" },
    expectedName: "Office Mac",
  },
])("preserves saved URLs with $name", async ({ names, expectedName }) => {
  const storagePath = await createStoragePath();
  await writeFile(
    storagePath,
    JSON.stringify({
      customServerUrl: firstUrl,
      target: "custom",
      customServerNames: names,
    }),
    "utf8",
  );
  const store = createServerTargetStore({ storagePath });
  await store.load();
  expect(store.getCustomServers()).toEqual([
    { url: firstUrl, name: expectedName },
  ]);
  expect(store.getTarget()).toEqual({ kind: "custom", url: firstUrl });
});

it("persists Connect server names by handle and drops invalid ones on load", async () => {
  const storagePath = await createStoragePath();
  const store = createServerTargetStore({ storagePath });
  await store.load();
  await store.setConnectServer(connectServer);
  await store.setConnectServerName(connectServer.handle, "Work laptop");
  expect(JSON.parse(await readFile(storagePath, "utf8"))).toMatchObject({
    connectServerNames: { laptop: "Work laptop" },
  });

  const reloaded = createServerTargetStore({ storagePath });
  await reloaded.load();
  expect(reloaded.getConnectServerName("laptop")).toBe("Work laptop");
  await reloaded.setConnectServerName("laptop", "   ");
  expect(reloaded.getConnectServerName("laptop")).toBeNull();
  expect(JSON.parse(await readFile(storagePath, "utf8"))).not.toHaveProperty(
    "connectServerNames",
  );

  await writeFile(
    storagePath,
    JSON.stringify({
      connectServer,
      customServerUrl: null,
      target: "connect",
      connectServerNames: { laptop: 42, desk: "  Desk  " },
    }),
    "utf8",
  );
  const invalid = createServerTargetStore({ storagePath });
  await invalid.load();
  expect(invalid.getTarget()).toEqual({
    kind: "connect",
    server: connectServer,
  });
  expect(invalid.getConnectServerName("laptop")).toBeNull();
  expect(invalid.getConnectServerName("desk")).toBe("Desk");
});

it("keeps an existing Connect server name when adopting a named custom URL", async () => {
  const storagePath = await createStoragePath();
  const store = createServerTargetStore({ storagePath });
  await store.load();
  await store.setConnectServerName(connectServer.handle, "Chosen");
  await store.setCustomServerUrl(connectServer.url, { name: "Custom" });

  expect(await store.adoptConnectServers([connectServer])).toBe(true);
  expect(store.getConnectServerName(connectServer.handle)).toBe("Chosen");
  expect(store.getCustomServers()).toEqual([]);
});

it("persists hidden visibility without changing the active target and preserves sibling metadata", async () => {
  const storagePath = await createStoragePath();
  await writeFile(
    storagePath,
    JSON.stringify({
      customServerUrl: firstUrl,
      customServerUrls: [firstUrl],
      target: "custom",
      customServerNames: { [firstUrl]: "Work" },
    }),
  );
  const store = createServerTargetStore({ storagePath });
  await store.load();
  expect(store.getShowBuiltinServer()).toBe(true);
  await store.setShowBuiltinServer(false);
  expect(store.getTarget()).toEqual({ kind: "custom", url: firstUrl });
  const reloaded = createServerTargetStore({ storagePath });
  await reloaded.load();
  expect(reloaded.getShowBuiltinServer()).toBe(false);
  expect(reloaded.getTarget()).toEqual({ kind: "custom", url: firstUrl });
  await reloaded.setTarget("builtin");
  await reloaded.setShowBuiltinServer(true);
  expect(reloaded.getTarget()).toEqual({ kind: "builtin" });
  const saved = JSON.parse(await readFile(storagePath, "utf8"));
  expect(saved.customServerNames).toEqual({ [firstUrl]: "Work" });
  expect(saved).not.toHaveProperty("showBuiltinServer");
});

it.each([
  { show: false, custom: true, connect: true, expected: "custom" },
  { show: false, custom: false, connect: true, expected: "connect" },
  { show: false, custom: true, connect: false, expected: "custom" },
  { show: false, custom: false, connect: false, expected: "builtin" },
  { show: true, custom: true, connect: true, expected: "builtin" },
  { show: true, custom: false, connect: true, expected: "builtin" },
])(
  "persists the removal fallback: %j",
  async ({ show, custom, connect, expected }) => {
    const storagePath = await createStoragePath();
    const store = createServerTargetStore({ storagePath });
    await store.load();
    if (connect) await store.setConnectServer(connectServer);
    if (custom) await store.setCustomServerUrl(firstUrl);
    await store.setCustomServerUrl(secondUrl);
    await store.setShowBuiltinServer(show);
    await store.setCustomServerUrl(null);
    const reloaded = createServerTargetStore({ storagePath });
    await reloaded.load();
    expect(reloaded.getShowBuiltinServer()).toBe(show);
    expect(reloaded.getCustomServerUrls()).toEqual(custom ? [firstUrl] : []);
    expect(reloaded.getTarget()).toEqual(
      expected === "connect"
        ? { kind: "connect", server: connectServer }
        : expected === "custom"
          ? { kind: "custom", url: firstUrl }
          : { kind: "builtin" },
    );
  },
);

it("falls back to discovered Connect servers in handle order when none is saved", async () => {
  const storagePath = await createStoragePath();
  const store = createServerTargetStore({ storagePath });
  await store.load();
  await store.setCustomServerUrl(firstUrl);
  await store.setShowBuiltinServer(false);
  const discovered = [
    { ...connectServer, handle: "z-last" },
    { ...connectServer, handle: "a-first" },
  ];
  await store.setCustomServerUrl(null, { availableConnectServers: discovered });
  const reloaded = createServerTargetStore({ storagePath });
  await reloaded.load();
  expect(reloaded.getTarget()).toEqual({
    kind: "connect",
    server: discovered[1],
  });
});
