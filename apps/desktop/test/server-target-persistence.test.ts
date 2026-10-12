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
    expect(store.getDefaultTarget()).toEqual(
      connect === null
        ? { kind: "custom", url: firstUrl }
        : { kind: "connect", server: connect },
    );
    await store.setWindowTarget("main", { kind: "custom", url: thirdUrl });
    await store.setDefaultTarget({ kind: "custom", url: thirdUrl });
    expect(JSON.parse(await readFile(storagePath, "utf8"))).toEqual({
      connectServer: connect,
      customServerUrl: thirdUrl,
      customServerUrls: urls,
      target: "custom",
      windowTargets: { main: { kind: "custom", url: thirdUrl } },
    });
    const reloaded = createServerTargetStore({ storagePath });
    await reloaded.load();
    expect(reloaded.getCustomServerUrls()).toEqual(urls);
    expect(reloaded.getDefaultTarget()).toEqual({
      kind: "custom",
      url: thirdUrl,
    });
    expect(reloaded.getWindowTarget("main")).toEqual({
      kind: "custom",
      url: thirdUrl,
    });
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
  expect(store.getDefaultTarget()).toEqual({ kind: "builtin" });
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
    const first = store.setDefaultTarget({ kind: "custom", url: firstUrl });
    const firstResult = Promise.allSettled([first]);
    await entered.promise;
    const second = store.setWindowTarget("main", {
      kind: "custom",
      url: secondUrl,
    });
    const third = store.setDefaultTarget({ kind: "builtin" });
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
      { status: "fulfilled", value: undefined },
    ]);
    expect(maximumActiveWrites).toBe(1);
    const reloaded = createServerTargetStore({ storagePath });
    await reloaded.load();
    expect(reloaded.getCustomServerUrls()).toEqual([firstUrl, secondUrl]);
    expect(reloaded.getWindowTarget("main")).toEqual({
      kind: "custom",
      url: secondUrl,
    });
    expect(reloaded.getDefaultTarget()).toEqual({ kind: "builtin" });
  },
);
