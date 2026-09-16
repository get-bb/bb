import { createParcelWatcherProxy } from "../src/parcel-subprocess/parcel-watcher-proxy.js";
import {
  setParcelWatcherBackend,
  disposeParcelWatcherBackend,
} from "../src/parcel-watcher-backend.js";
import { createParcelHostWatcher } from "../src/parcel-host-watcher.js";
import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createChildChannel } from "../src/parcel-subprocess/fork-channel.js";
import type { ChildToParentMessage } from "../src/parcel-subprocess/messages.js";

it("recovers an oversized native rescan and continues delivering file changes", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "bb-watcher-backpressure-"),
  );
  const child = fork(
    fileURLToPath(
      new URL(
        "../src/parcel-subprocess/parcel-child-entry.ts",
        import.meta.url,
      ),
    ),
    [],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    },
  );
  const channel = createChildChannel(child);
  const messages: ChildToParentMessage[] = [];
  channel.onMessage((message) => messages.push(message));
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  try {
    for (let offset = 0; offset < 4000; offset += 100) {
      await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          fs.writeFile(
            path.join(root, `${offset + index}-${"x".repeat(180)}`),
            "",
          ),
        ),
      );
    }
    await expect
      .poll(() => messages.some((message) => message.kind === "ready"))
      .toBe(true);
    channel.send({
      kind: "subscribe",
      id: "oversized",
      dir: root,
      rescan: true,
    });
    await expect
      .poll(
        () =>
          messages.some(
            (message) =>
              message.kind === "watch-error" &&
              message.id === "oversized" &&
              message.recovery === "rescan-subscription",
          ),
        { timeout: 10000 },
      )
      .toBe(true);
    expect(messages.some((message) => message.kind === "events")).toBe(false);
    channel.send({ kind: "unsubscribe", id: "oversized" });
    await expect
      .poll(() => messages.some((message) => message.kind === "unsubscribed"))
      .toBe(true);
    channel.send({ kind: "subscribe", id: "replacement", dir: root });
    await expect
      .poll(
        () =>
          messages.some(
            (message) =>
              message.kind === "subscribed" && message.id === "replacement",
          ),
        { timeout: 10000 },
      )
      .toBe(true);
    const changedPath = path.join(root, "after-recovery.txt");
    await fs.writeFile(changedPath, "recovered");
    await expect
      .poll(() =>
        messages.some(
          (message) =>
            message.kind === "events" &&
            message.id === "replacement" &&
            message.events.some(
              (event) => event.path === changedPath && event.type === "create",
            ),
        ),
      )
      .toBe(true);
    channel.send({ kind: "ping", nonce: 42 });
    await expect
      .poll(() =>
        messages.some(
          (message) => message.kind === "pong" && message.nonce === 42,
        ),
      )
      .toBe(true);
  } finally {
    child.kill("SIGKILL");
    await exited;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);

it("automatically refreshes and resubscribes only the overloaded root", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "bb-watcher-auto-recovery-"),
  );
  const affected = path.join(root, "affected");
  const unaffected = path.join(root, "unaffected");
  await Promise.all([fs.mkdir(affected), fs.mkdir(unaffected)]);
  const changedDuringRecovery = path.join(affected, "gap.txt");
  await fs.writeFile(changedDuringRecovery, "before");
  for (let offset = 0; offset < 4000; offset += 100) {
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        fs.writeFile(
          path.join(affected, `${offset + index}-${"x".repeat(180)}`),
          "",
        ),
      ),
    );
  }
  const children: ChildProcess[] = [];
  const exits: Promise<void>[] = [];
  const subscriptions: string[] = [];
  const nativeReady: string[] = [];
  const changedPaths: string[] = [];
  const errors: string[] = [];
  const recoveryReads: Promise<string>[] = [];
  let unaffectedRescans = 0;
  let injectOversizedRescan = true;
  const proxy = createParcelWatcherProxy({
    spawnChannel: () => {
      const child = fork(
        fileURLToPath(
          new URL(
            "../src/parcel-subprocess/parcel-child-entry.ts",
            import.meta.url,
          ),
        ),
        [],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "inherit", "ipc"],
        },
      );
      children.push(child);
      exits.push(
        new Promise<void>((resolve) => child.once("exit", () => resolve())),
      );
      const channel = createChildChannel(child);
      return {
        ...channel,
        send(message) {
          if (message.kind === "subscribe") {
            subscriptions.push(message.dir);
            if (message.dir === affected && injectOversizedRescan) {
              injectOversizedRescan = false;
              channel.send({ ...message, rescan: true });
              return;
            }
          }
          channel.send(message);
        },
        onMessage(listener) {
          channel.onMessage((message) => {
            if (message.kind === "subscribed") nativeReady.push(message.id);
            listener(message);
          });
        },
      };
    },
  });
  setParcelWatcherBackend(proxy);
  const watcher = createParcelHostWatcher();
  const stops: Array<() => void | Promise<void>> = [];
  try {
    for (const directory of [affected, unaffected]) {
      stops.push(
        watcher.watchPathRoot!({
          rootPath: directory,
          ignoredPaths: [],
          onReady: () => {},
          onChange: (events) =>
            changedPaths.push(...events.map((event) => event.path)),
          onWatchError: (error) => errors.push(error.message),
          onRescanRequired: () => {
            if (directory === unaffected) {
              unaffectedRescans += 1;
              return;
            }
            if (recoveryReads.length === 0) {
              recoveryReads.push(
                fs
                  .writeFile(changedDuringRecovery, "during recovery")
                  .then(() => fs.readFile(changedDuringRecovery, "utf8")),
              );
            } else {
              recoveryReads.push(fs.readFile(changedDuringRecovery, "utf8"));
            }
          },
        }),
      );
    }
    await expect.poll(() => nativeReady.length, { timeout: 10000 }).toBe(3);
    await expect.poll(() => recoveryReads.length).toBe(2);
    expect(await Promise.all(recoveryReads)).toEqual([
      "during recovery",
      "during recovery",
    ]);
    expect(
      subscriptions.filter((directory) => directory === affected),
    ).toHaveLength(2);
    expect(
      subscriptions.filter((directory) => directory === unaffected),
    ).toHaveLength(1);
    expect(unaffectedRescans).toBe(0);
    for (const directory of [affected, unaffected]) {
      const file = path.join(directory, "after.txt");
      await fs.writeFile(file, "after");
      await expect.poll(() => changedPaths.includes(file)).toBe(true);
    }
    expect(children).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(stops.map((stop) => stop()));
    disposeParcelWatcherBackend();
    for (const child of children) child.kill("SIGKILL");
    await Promise.all(exits);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
