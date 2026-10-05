import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { makeDispatchOptions } from "../test/command/dispatch-helpers.js";
import {
  dispatchCommand,
  dispatchOnlineRpcCommand,
} from "./command-dispatch.js";
import { RuntimeManager } from "./runtime-manager.js";

it.for(["thread deletion", "orphan removal"] as const)(
  "%s stops processes in nested thread storage before removing files and preserves neighboring processes",
  async (cleanup, { skip }) => {
    skip(
      process.platform === "win32",
      "killProcessesWithCwdUnder does not enumerate process working directories on Windows",
    );
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-storage-delete-"));
    const storageRoot = path.join(root, "thread-storage");
    const storagePath = path.join(storageRoot, "thr_busy");
    const checkout = path.join(storagePath, "checkout", "app");
    const neighbor = path.join(storageRoot, "thr_busy-other");
    const receipt = path.join(root, "terminated.json");
    await fs.mkdir(checkout, { recursive: true });
    await fs.mkdir(neighbor, { recursive: true });
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const fs = require('node:fs');
        process.on('SIGTERM', () => {
          fs.writeFileSync(process.argv[1], JSON.stringify(fs.existsSync(process.cwd())));
          process.exit(0);
        });
        setInterval(() => {}, 1000);
        process.send('ready');`,
        receipt,
      ],
      {
        cwd: checkout,
        detached: true,
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      },
    );
    const sibling = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000); process.send('ready');"],
      {
        cwd: neighbor,
        detached: true,
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      },
    );
    const childReady = once(child, "message");
    const siblingReady = once(sibling, "message");
    try {
      await Promise.all([childReady, siblingReady]);
      const options = makeDispatchOptions({
        runtimeManager: new RuntimeManager(),
        threadStorageRootPath: storageRoot,
      });
      if (cleanup === "thread deletion") {
        await dispatchCommand(
          {
            type: "thread.storage.delete",
            threadId: "thr_busy",
            environmentId: "env_busy",
          },
          options,
        );
      } else {
        await dispatchOnlineRpcCommand(
          {
            type: "host.remove_path",
            path: storagePath,
            rootPath: storageRoot,
            recursive: true,
          },
          options,
        );
      }
      await expect(fs.stat(storagePath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(child.exitCode).toBe(0);
      await expect(fs.readFile(receipt, "utf8")).resolves.toBe("true");
      expect(sibling.exitCode).toBeNull();
      expect(sibling.signalCode).toBeNull();
      await expect(fs.stat(neighbor)).resolves.toMatchObject({});
    } finally {
      await Promise.all(
        [child, sibling].map(async (running) => {
          if (running.exitCode !== null || running.signalCode !== null) return;
          const exited = once(running, "exit");
          running.kill("SIGKILL");
          await exited;
        }),
      );
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
