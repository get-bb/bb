import { execFile } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalString, parseSessionEgg } from "./rapp1.js";
import { RappSessionStore } from "./session-store.js";

const directories: string[] = [];
const execFileAsync = promisify(execFile);

function makeDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "bb-rapp-session-"));
  directories.push(directory);
  return directory;
}

function sessionHeadPath(directory: string): string {
  const files = readdirSync(join(directory, "sessions"));
  expect(files).toHaveLength(1);
  return join(directory, "sessions", files[0] ?? "");
}

function readHead(directory: string): {
  schema: string;
  provider_thread_id: string;
  egg_address: string;
  turn_counter: number;
} {
  return JSON.parse(readFileSync(sessionHeadPath(directory), "utf8"));
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("RAPP session store", () => {
  it("stores immutable addressed eggs behind a validated thread head", () => {
    const directory = makeDirectory();
    const first = new RappSessionStore(directory);
    const created = first.create("rapp_thread");
    expect(created.snapshot).toEqual({
      providerThreadId: "rapp_thread",
      remoteSessionId: null,
      turnCounter: 0,
      transcript: [],
      pendingTurn: null,
    });
    const saved = first.save({
      ...created.snapshot,
      remoteSessionId: "remote_thread",
      turnCounter: 2,
      transcript: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
    });

    const head = readHead(directory);
    expect(head).toEqual({
      schema: "bb/provider-rapp-session-head/1",
      provider_thread_id: "rapp_thread",
      egg_address: saved.eggAddress,
      turn_counter: 2,
    });
    const objectPath = join(directory, "objects", `${saved.eggAddress}.json`);
    const parsed = parseSessionEgg(readFileSync(objectPath), saved.rappid);
    expect(parsed.eggAddress).toBe(saved.eggAddress);
    expect(parsed.runtime.provider_thread_id).toBe("rapp_thread");
    expect(parsed.runtime.remote_session_id).toBe("remote_thread");
    expect(parsed.runtime.turn_counter).toBe(2);
    expect(parsed.egg.payload.transcript).toEqual(saved.snapshot.transcript);

    const second = new RappSessionStore(directory);
    expect(second.load("rapp_thread")).toEqual(saved);
    expect(readdirSync(join(directory, "objects")).length).toBeGreaterThan(1);
  });

  it("round-trips a persisted pending turn transaction", () => {
    const directory = makeDirectory();
    const first = new RappSessionStore(directory);
    const created = first.create("rapp_thread");
    const saved = first.save({
      ...created.snapshot,
      turnCounter: 1,
      pendingTurn: {
        idempotencyKey: "rapp_thread:1",
        userInput: "hello",
        conversationHistory: [
          { role: "user", content: "prior" },
          { role: "assistant", content: "context" },
        ],
      },
    });

    const second = new RappSessionStore(directory);
    expect(second.load("rapp_thread")).toEqual(saved);
    const loaded = second.load("rapp_thread");
    loaded?.snapshot.pendingTurn?.conversationHistory.push({
      role: "user",
      content: "mutated",
    });
    expect(second.load("rapp_thread")).toEqual(saved);
  });

  it("refuses an egg object whose bytes no longer match its address", () => {
    const directory = makeDirectory();
    const first = new RappSessionStore(directory);
    const created = first.create("rapp_thread");
    const saved = first.save({
      ...created.snapshot,
      remoteSessionId: "remote_thread",
      turnCounter: 1,
      transcript: [{ role: "user", content: "hello" }],
    });
    const objectPath = join(directory, "objects", `${saved.eggAddress}.json`);
    const egg = JSON.parse(readFileSync(objectPath, "utf8"));
    egg.payload.transcript[0].content = "tampered";
    writeFileSync(objectPath, canonicalString(egg), "utf8");

    const second = new RappSessionStore(directory);
    expect(() => second.load("rapp_thread")).toThrow(
      "address does not match its head",
    );
  });

  it("refuses a head that rolls back to an older egg address", () => {
    const directory = makeDirectory();
    const first = new RappSessionStore(directory);
    const created = first.create("rapp_thread");
    const saved = first.save({
      ...created.snapshot,
      remoteSessionId: "remote_thread",
      turnCounter: 2,
      transcript: [{ role: "user", content: "hello" }],
    });
    const headPath = sessionHeadPath(directory);
    const head = readHead(directory);
    writeFileSync(
      headPath,
      canonicalString({
        ...head,
        egg_address: created.eggAddress,
      }),
      "utf8",
    );

    const second = new RappSessionStore(directory);
    expect(() => second.load("rapp_thread")).toThrow(
      "turn counter does not match",
    );
    expect(() => first.save(created.snapshot)).toThrow("roll back");
    expect(first.load("rapp_thread")).toEqual(saved);
  });

  it("refuses a head address that names different object bytes", () => {
    const directory = makeDirectory();
    const first = new RappSessionStore(directory);
    const saved = first.create("rapp_thread");
    const wrongAddress = "f".repeat(64);
    copyFileSync(
      join(directory, "objects", `${saved.eggAddress}.json`),
      join(directory, "objects", `${wrongAddress}.json`),
    );
    const headPath = sessionHeadPath(directory);
    const head = readHead(directory);
    writeFileSync(
      headPath,
      canonicalString({
        ...head,
        egg_address: wrongAddress,
      }),
      "utf8",
    );

    const second = new RappSessionStore(directory);
    expect(() => second.load("rapp_thread")).toThrow(
      "address does not match its head",
    );
  });

  it("does not publish a failed session write into memory", () => {
    const directory = makeDirectory();
    const store = new RappSessionStore(directory);
    const created = store.create("rapp_thread");
    rmSync(join(directory, "sessions"), { recursive: true });
    writeFileSync(join(directory, "sessions"), "not a directory", "utf8");

    expect(() =>
      store.save({
        ...created.snapshot,
        remoteSessionId: "remote_thread",
        turnCounter: 1,
      }),
    ).toThrow();
    expect(store.load("rapp_thread")).toEqual(created);
  });

  it("keeps cached state when deleting the durable head fails", () => {
    const directory = makeDirectory();
    const store = new RappSessionStore(directory);
    const created = store.create("rapp_thread");
    const headPath = sessionHeadPath(directory);
    rmSync(headPath);
    mkdirSync(headPath);

    expect(() => store.delete("rapp_thread")).toThrow();
    expect(store.load("rapp_thread")).toEqual(created);
  });

  it("reuses one persisted mint across store instances", () => {
    const directory = makeDirectory();
    const first = new RappSessionStore(directory);
    const firstSession = first.create("first_thread");
    const second = new RappSessionStore(directory);
    const secondSession = second.create("second_thread");

    expect(secondSession.rappid).toBe(firstSession.rappid);
  });

  it("mints one identity under concurrent process startup", async () => {
    const directory = makeDirectory();
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    const repositoryRoot = join(packageRoot, "..", "..");
    const storeModuleUrl = pathToFileURL(
      join(packageRoot, "src", "session-store.ts"),
    ).href;
    const script = `
      import { RappSessionStore } from ${JSON.stringify(storeModuleUrl)};
      const store = new RappSessionStore(process.argv[1]);
      const saved = store.create(process.argv[2]);
      process.stdout.write(saved.rappid);
    `;
    const [first, second] = await Promise.all([
      execFileAsync(
        process.execPath,
        ["--import", "tsx", "--eval", script, directory, "first_thread"],
        { cwd: repositoryRoot },
      ),
      execFileAsync(
        process.execPath,
        ["--import", "tsx", "--eval", script, directory, "second_thread"],
        { cwd: repositoryRoot },
      ),
    ]);

    expect(String(first.stdout).trim()).toBe(String(second.stdout).trim());
    const third = new RappSessionStore(directory);
    expect(third.create("third_thread").rappid).toBe(
      String(first.stdout).trim(),
    );
  });

  it("fails closed when identity is missing beside persisted state", () => {
    const directory = makeDirectory();
    mkdirSync(join(directory, "sessions"), { recursive: true });
    mkdirSync(join(directory, "objects"), { recursive: true });
    writeFileSync(
      join(directory, "objects", `${"a".repeat(64)}.json`),
      "{}",
      "utf8",
    );

    expect(() => new RappSessionStore(directory)).toThrow(
      "identity is missing",
    );
  });
});
