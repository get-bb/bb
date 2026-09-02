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
import { canonicalString, hashValue, parseSessionEgg } from "./rapp1.js";
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
  delivery_address?: string | null;
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
    const saved = first.save(
      {
        ...created.snapshot,
        remoteSessionId: "remote_thread",
        turnCounter: 2,
        transcript: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi" },
        ],
      },
      null,
    );

    const head = readHead(directory);
    expect(head).toEqual({
      schema: "bb/provider-rapp-session-head/2",
      provider_thread_id: "rapp_thread",
      egg_address: saved.eggAddress,
      delivery_address: null,
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
    const saved = first.save(
      {
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
      },
      null,
    );

    const second = new RappSessionStore(directory);
    expect(second.load("rapp_thread")).toEqual(saved);
    const loaded = second.load("rapp_thread");
    loaded?.snapshot.pendingTurn?.conversationHistory.push({
      role: "user",
      content: "mutated",
    });
    expect(second.load("rapp_thread")).toEqual(saved);
  });

  it("commits and acknowledges a content-addressed delivery journal with its completed transcript", () => {
    const directory = makeDirectory();
    const first = new RappSessionStore(directory);
    const created = first.create("rapp_thread");
    const completed = first.save(
      {
        ...created.snapshot,
        remoteSessionId: "remote-session",
        turnCounter: 1,
        transcript: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "durable answer" },
        ],
      },
      {
        providerTurnId: "rapp_thread-turn-1",
        agentItemId: "rapp_thread-t1-agents",
        messageItemId: "rapp_thread-t1-message",
        response: "durable answer",
        agentLogs: ["AgentOne"],
        grail: "consumer",
        endpoint: "http://127.0.0.1:7071/chat",
        selectedModel: "rapp-brainstem",
        requestedModel: "claude-opus-5",
        actualModel: "claude-opus-5",
      },
    );

    expect(completed.deliveryAddress).toMatch(/^[0-9a-f]{64}$/u);
    expect(completed.pendingDelivery).toMatchObject({
      providerTurnId: "rapp_thread-turn-1",
      response: "durable answer",
      agentLogs: ["AgentOne"],
      eggAddress: completed.eggAddress,
      phase: "ready",
    });
    expect(readHead(directory)).toEqual({
      schema: "bb/provider-rapp-session-head/2",
      provider_thread_id: "rapp_thread",
      egg_address: completed.eggAddress,
      delivery_address: completed.deliveryAddress,
      turn_counter: 1,
    });

    const recovered = new RappSessionStore(directory).load("rapp_thread");
    expect(recovered).toEqual(completed);
    if (completed.deliveryAddress === null) {
      throw new Error("delivery address was not persisted");
    }
    const emitted = first.markDeliveryEmitted(
      "rapp_thread",
      completed.deliveryAddress,
    );
    expect(emitted.eggAddress).toBe(completed.eggAddress);
    expect(emitted.deliveryAddress).not.toBe(completed.deliveryAddress);
    expect(emitted.pendingDelivery?.phase).toBe("emitted");
    if (emitted.deliveryAddress === null) {
      throw new Error("emitted delivery address was not persisted");
    }
    const acknowledged = first.acknowledgeDelivery(
      "rapp_thread",
      emitted.deliveryAddress,
    );
    expect(acknowledged.snapshot).toEqual(completed.snapshot);
    expect(acknowledged.eggAddress).toBe(completed.eggAddress);
    expect(acknowledged.pendingDelivery).toBeNull();
    expect(acknowledged.deliveryAddress).toBeNull();
    expect(new RappSessionStore(directory).load("rapp_thread")).toEqual(
      acknowledged,
    );
  });

  it("loads version-one delivery journals as unacknowledged ready deliveries", () => {
    const directory = makeDirectory();
    const store = new RappSessionStore(directory);
    const created = store.create("rapp_thread");
    const completed = store.save(
      {
        ...created.snapshot,
        remoteSessionId: "remote-session",
        turnCounter: 1,
        transcript: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "legacy durable answer" },
        ],
      },
      {
        providerTurnId: "rapp_thread-turn-1",
        agentItemId: "rapp_thread-t1-agents",
        messageItemId: "rapp_thread-t1-message",
        response: "legacy durable answer",
        agentLogs: ["LegacyAgent"],
        grail: "consumer",
        endpoint: "http://127.0.0.1:7071/chat",
        selectedModel: "brainstem",
        requestedModel: "claude-opus-5",
        actualModel: "claude-opus-5",
      },
    );
    const legacyDelivery = {
      schema: "bb/provider-rapp-delivery/1",
      provider_thread_id: "rapp_thread",
      egg_address: completed.eggAddress,
      turn_counter: 1,
      provider_turn_id: "rapp_thread-turn-1",
      agent_item_id: "rapp_thread-t1-agents",
      message_item_id: "rapp_thread-t1-message",
      response: "legacy durable answer",
      agent_logs: ["LegacyAgent"],
      grail: "consumer",
      endpoint: "http://127.0.0.1:7071/chat",
      selected_model: "brainstem",
      requested_model: "claude-opus-5",
      actual_model: "claude-opus-5",
    };
    const legacyDeliveryAddress = hashValue(
      "bb/provider-rapp-delivery",
      legacyDelivery,
    );
    writeFileSync(
      join(directory, "objects", `${legacyDeliveryAddress}.json`),
      canonicalString(legacyDelivery),
      "utf8",
    );
    writeFileSync(
      sessionHeadPath(directory),
      canonicalString({
        schema: "bb/provider-rapp-session-head/2",
        provider_thread_id: "rapp_thread",
        egg_address: completed.eggAddress,
        delivery_address: legacyDeliveryAddress,
        turn_counter: 1,
      }),
      "utf8",
    );

    const migratedStore = new RappSessionStore(directory);
    const loaded = migratedStore.load("rapp_thread");
    expect(loaded?.deliveryAddress).toBe(legacyDeliveryAddress);
    expect(loaded?.pendingDelivery).toMatchObject({
      response: "legacy durable answer",
      agentLogs: ["LegacyAgent"],
      phase: "ready",
    });
    const emitted = migratedStore.markDeliveryEmitted(
      "rapp_thread",
      legacyDeliveryAddress,
    );
    expect(emitted.pendingDelivery?.phase).toBe("emitted");
    if (emitted.deliveryAddress === null) {
      throw new Error("Migrated delivery address was not persisted");
    }
    expect(
      JSON.parse(
        readFileSync(
          join(directory, "objects", `${emitted.deliveryAddress}.json`),
          "utf8",
        ),
      ),
    ).toMatchObject({
      schema: "bb/provider-rapp-delivery/2",
      phase: "emitted",
    });
  });

  it("rejects delivery journal bytes that no longer match their address", () => {
    const directory = makeDirectory();
    const store = new RappSessionStore(directory);
    const created = store.create("rapp_thread");
    const completed = store.save(
      {
        ...created.snapshot,
        turnCounter: 1,
        transcript: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "answer" },
        ],
      },
      {
        providerTurnId: "turn-1",
        agentItemId: null,
        messageItemId: "message-1",
        response: "answer",
        agentLogs: [],
        grail: "consumer",
        endpoint: "http://127.0.0.1:7071/chat",
        selectedModel: "rapp-brainstem",
        requestedModel: null,
        actualModel: null,
      },
    );
    if (completed.deliveryAddress === null) {
      throw new Error("delivery address was not persisted");
    }
    const deliveryPath = join(
      directory,
      "objects",
      `${completed.deliveryAddress}.json`,
    );
    const delivery = JSON.parse(readFileSync(deliveryPath, "utf8"));
    delivery.endpoint = "https://tampered.example/chat";
    writeFileSync(deliveryPath, canonicalString(delivery), "utf8");

    expect(() => new RappSessionStore(directory).load("rapp_thread")).toThrow(
      "delivery journal address does not match",
    );
  });

  it("loads legacy version-one heads with ambiguous pending turns intact", () => {
    const directory = makeDirectory();
    const store = new RappSessionStore(directory);
    const saved = store.save(
      {
        ...store.create("rapp_thread").snapshot,
        turnCounter: 1,
        pendingTurn: {
          idempotencyKey: "legacy-request",
          userInput: "legacy pending prompt",
          conversationHistory: [{ role: "assistant", content: "prior answer" }],
        },
      },
      null,
    );
    writeFileSync(
      sessionHeadPath(directory),
      canonicalString({
        schema: "bb/provider-rapp-session-head/1",
        provider_thread_id: "rapp_thread",
        egg_address: saved.eggAddress,
        turn_counter: 1,
      }),
      "utf8",
    );

    const loaded = new RappSessionStore(directory).load("rapp_thread");
    expect(loaded).toEqual(saved);
    expect(loaded?.snapshot.pendingTurn).toEqual({
      idempotencyKey: "legacy-request",
      userInput: "legacy pending prompt",
      conversationHistory: [{ role: "assistant", content: "prior answer" }],
    });
    expect(loaded?.pendingDelivery).toBeNull();
  });

  it("rejects a new turn when the worst-case bounded completion cannot fit the session egg", () => {
    const store = new RappSessionStore();
    const created = store.create("rapp_thread");
    const nearLimit = store.save(
      {
        ...created.snapshot,
        turnCounter: 1,
        transcript: [{ role: "assistant", content: "x".repeat(985_000) }],
      },
      null,
    );

    expect(() =>
      store.assertCanCommitCompletion(
        {
          ...nearLimit.snapshot,
          turnCounter: 2,
        },
        "one more question",
        64 * 1024,
      ),
    ).toThrow("Start a new thread");
  });

  it("refuses an egg object whose bytes no longer match its address", () => {
    const directory = makeDirectory();
    const first = new RappSessionStore(directory);
    const created = first.create("rapp_thread");
    const saved = first.save(
      {
        ...created.snapshot,
        remoteSessionId: "remote_thread",
        turnCounter: 1,
        transcript: [{ role: "user", content: "hello" }],
      },
      null,
    );
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
    const saved = first.save(
      {
        ...created.snapshot,
        remoteSessionId: "remote_thread",
        turnCounter: 2,
        transcript: [{ role: "user", content: "hello" }],
      },
      null,
    );
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
    expect(() => first.save(created.snapshot, null)).toThrow("roll back");
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
      store.save(
        {
          ...created.snapshot,
          remoteSessionId: "remote_thread",
          turnCounter: 1,
        },
        null,
      ),
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
