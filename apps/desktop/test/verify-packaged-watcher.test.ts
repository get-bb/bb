import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(join(process.cwd(), "package.json"));
const {
  verifyPackagedWatcher,
}: {
  verifyPackagedWatcher(options: {
    executablePath: string;
    childEntry: string;
    timeoutMs?: number;
  }): Promise<void>;
} = require("./scripts/verify-packaged-watcher.cjs");

async function fixture(
  source: string,
  run: (childEntry: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "bb-watcher-probe-test-"));
  try {
    const childEntry = join(root, "child.cjs");
    await writeFile(childEntry, source);
    await run(childEntry);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("packaged watcher verification", () => {
  it("rejects a missing packaged executable", async () => {
    await fixture("", async (childEntry) => {
      await expect(
        verifyPackagedWatcher({
          executablePath: childEntry + ".missing",
          childEntry,
        }),
      ).rejects.toThrow("ENOENT");
    });
  });

  it("rejects a clean exit that never delivered a file event", async () => {
    await fixture(
      `
      process.send({ kind: 'ready' });
      process.on('message', message => {
        process.send({ kind: 'subscribed', id: message.id }, () => process.exit(0));
      });
    `,
      async (childEntry) => {
        await expect(
          verifyPackagedWatcher({
            executablePath: process.execPath,
            childEntry,
          }),
        ).rejects.toThrow("before completing the probe");
      },
    );
  });

  it("rejects a native import failure with its stderr diagnostic", async () => {
    await fixture(
      'throw new Error("No prebuild or local build of @parcel/watcher found");',
      async (childEntry) => {
        await expect(
          verifyPackagedWatcher({
            executablePath: process.execPath,
            childEntry,
          }),
        ).rejects.toThrow(
          "No prebuild or local build of @parcel/watcher found",
        );
      },
    );
  });

  it("rejects subscription failure after a successful import", async () => {
    await fixture(
      `
      process.send({ kind: 'ready' });
      process.on('message', message => {
        process.send({ kind: 'subscribe-failed', id: message.id, message: 'native backend unavailable' });
      });
    `,
      async (childEntry) => {
        await expect(
          verifyPackagedWatcher({
            executablePath: process.execPath,
            childEntry,
          }),
        ).rejects.toThrow("native backend unavailable");
      },
    );
  });

  it("kills a child that reports ready but never confirms its subscription", async () => {
    await fixture(
      `process.send({ kind: 'ready' }); setInterval(() => {}, 1000);`,
      async (childEntry) => {
        await expect(
          verifyPackagedWatcher({
            executablePath: process.execPath,
            childEntry,
            timeoutMs: 500,
          }),
        ).rejects.toThrow("subscribed=false");
      },
    );
  });

  it("requires an actual file event after subscription and removes its temporary root", async () => {
    await fixture(
      `
      const fs = require('node:fs');
      const path = require('node:path');
      let watcher;
      process.send({ kind: 'ready' });
      process.on('message', message => {
        if (message.kind === 'subscribe') {
          fs.writeFileSync(__filename + '.root', message.dir);
          watcher = fs.watch(message.dir, (event, file) => {
            if (file !== 'watcher-probe.txt') return;
            process.send({ kind: 'events', id: message.id, events: [{ path: path.join(message.dir, file), type: 'create' }] });
          });
          process.send({ kind: 'subscribed', id: message.id });
        } else if (message.kind === 'unsubscribe') {
          watcher.close();
          process.send({ kind: 'unsubscribed', id: message.id });
        }
      });
      process.on('disconnect', () => process.exit(0));
    `,
      async (childEntry) => {
        await verifyPackagedWatcher({
          executablePath: process.execPath,
          childEntry,
        });
        const root = await readFile(childEntry + ".root", "utf8");
        await expect(
          readFile(join(root, "watcher-probe.txt")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      },
    );
  });
});
