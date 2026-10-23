import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { PassThrough } from "node:stream";
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import type { TerminalUpgradeGrant } from "../../src/services/terminals/terminal-relay.js";
import {
  createTerminalRelayRouter,
  type TerminalRelayEndpoint,
} from "../../src/services/terminals/terminal-relay-transport.js";

interface FakeRelay extends TerminalRelayEndpoint {
  closed: boolean;
  outputs: string[];
  upgrades: string[];
}

function fakeRelay(): FakeRelay {
  const relay: FakeRelay = {
    closed: false,
    outputs: [],
    upgrades: [],
    control: {
      closeDaemonSession: () => undefined,
      handleDaemonControlMessage: ({ message }) => {
        relay.outputs.push(message.terminalId);
      },
      publishSession: () => undefined,
    },
    bindHost: () => undefined,
    close: () => {
      relay.closed = true;
      return Promise.resolve();
    },
    upgrade: ({ grant }) => {
      relay.upgrades.push(
        grant.kind === "daemon" ? `daemon:${grant.daemonSessionId}` : grant.terminalId,
      );
    },
  };
  return relay;
}

function browserGrant(terminalId: string): TerminalUpgradeGrant {
  return {
    kind: "browser",
    outputAcks: false,
    sinceSeq: 0,
    terminal: {
      daemonSessionId: "daemon-1",
      session: {
        id: terminalId,
        threadId: null,
        environmentId: null,
        hostId: "host-1",
        title: "Terminal",
        initialCwd: "/tmp",
        cols: 80,
        rows: 24,
        status: "running",
        exitCode: null,
        closeReason: null,
        createdAt: 0,
        updatedAt: 0,
        lastUserInputAt: null,
      },
    },
    terminalId,
  };
}

function createFixture() {
  const inProcess = fakeRelay();
  const started: FakeRelay[] = [];
  const setting = { useProcess: false };
  const router = createTerminalRelayRouter({
    inProcess,
    startProcess: () => {
      const relay = fakeRelay();
      started.push(relay);
      return relay;
    },
    useProcess: () => setting.useProcess,
  });
  const upgrade = (grant: TerminalUpgradeGrant): PassThrough => {
    const socket = new PassThrough();
    router.upgrade({
      grant,
      head: Buffer.alloc(0),
      request: new IncomingMessage(new Socket()),
      socket,
    });
    return socket;
  };
  const output = (terminalId: string): void => {
    router.control.handleDaemonControlMessage({
      daemonSessionId: "daemon-1",
      message: {
        type: "terminal.output",
        terminalId,
        chunk: { seq: 0, dataBase64: "YQ==" },
      },
    });
  };
  const exit = (terminalId: string): void => {
    const terminal = browserGrant(terminalId);
    if (terminal.kind !== "browser" || terminal.terminal === null) {
      throw new Error("Expected a browser grant");
    }
    router.control.publishSession({
      kind: "exited",
      terminal: {
        ...terminal.terminal,
        session: { ...terminal.terminal.session, status: "exited" },
      },
    });
  };
  return { exit, inProcess, output, router, setting, started, upgrade };
}

describe("terminal relay router", () => {
  it("opens new terminals where the setting says and keeps open ones where they started", () => {
    const fixture = createFixture();

    fixture.upgrade(browserGrant("before"));
    fixture.setting.useProcess = true;
    fixture.router.reconcile();
    fixture.upgrade(browserGrant("after"));
    fixture.upgrade(browserGrant("before"));
    fixture.output("before");
    fixture.output("after");

    const [processRelay] = fixture.started;
    expect(fixture.inProcess.upgrades).toEqual(["before", "before"]);
    expect(processRelay?.upgrades).toEqual(["after"]);
    expect(fixture.inProcess.outputs).toEqual(["before"]);
    expect(processRelay?.outputs).toEqual(["after"]);
  });

  it("keeps the relay process until its last terminal exits after the setting turns off", () => {
    const fixture = createFixture();
    fixture.setting.useProcess = true;
    fixture.router.reconcile();
    fixture.upgrade(browserGrant("forked"));

    fixture.setting.useProcess = false;
    fixture.router.reconcile();
    fixture.upgrade(browserGrant("main"));
    fixture.upgrade(browserGrant("forked"));
    const [processRelay] = fixture.started;
    expect(processRelay?.closed).toBe(false);
    expect(processRelay?.upgrades).toEqual(["forked", "forked"]);
    expect(fixture.inProcess.upgrades).toEqual(["main"]);

    fixture.exit("forked");
    expect(processRelay?.closed).toBe(true);
    expect(fixture.started).toHaveLength(1);
  });

  it("accepts daemon data sockets only while the relay process runs", () => {
    const fixture = createFixture();
    const daemonGrant: TerminalUpgradeGrant = {
      kind: "daemon",
      daemonSessionId: "daemon-1",
    };

    const refused = fixture.upgrade(daemonGrant);
    expect(String(refused.read())).toContain("503");

    fixture.setting.useProcess = true;
    fixture.router.reconcile();
    fixture.upgrade(daemonGrant);

    expect(fixture.started[0]?.upgrades).toEqual(["daemon:daemon-1"]);
    expect(fixture.inProcess.upgrades).toEqual([]);
  });
});
