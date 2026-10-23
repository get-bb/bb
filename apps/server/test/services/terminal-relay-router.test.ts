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
  outputs: string[];
  upgrades: string[];
}

function fakeRelay(): FakeRelay {
  const relay: FakeRelay = {
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
    close: () => Promise.resolve(),
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
  const processRelay = fakeRelay();
  const setting = { useProcess: false };
  const router = createTerminalRelayRouter({
    inProcess,
    process: processRelay,
    useProcess: () => setting.useProcess,
  });
  const upgrade = (grant: TerminalUpgradeGrant): void => {
    router.upgrade({
      grant,
      head: Buffer.alloc(0),
      request: new IncomingMessage(new Socket()),
      socket: new PassThrough(),
    });
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
  return { inProcess, output, processRelay, setting, upgrade };
}

describe("terminal relay router", () => {
  it("opens new terminals where the setting says and keeps open ones where they started", () => {
    const fixture = createFixture();

    fixture.upgrade(browserGrant("before"));
    fixture.setting.useProcess = true;
    fixture.upgrade(browserGrant("after"));
    fixture.upgrade(browserGrant("before"));
    fixture.setting.useProcess = false;
    fixture.upgrade(browserGrant("after"));
    fixture.output("before");
    fixture.output("after");

    expect(fixture.inProcess.upgrades).toEqual(["before", "before"]);
    expect(fixture.processRelay.upgrades).toEqual(["after", "after"]);
    expect(fixture.inProcess.outputs).toEqual(["before"]);
    expect(fixture.processRelay.outputs).toEqual(["after"]);
  });

  it("sends daemon data sockets to the relay process whatever the setting", () => {
    const fixture = createFixture();

    fixture.upgrade({ kind: "daemon", daemonSessionId: "daemon-1" });

    expect(fixture.processRelay.upgrades).toEqual(["daemon:daemon-1"]);
    expect(fixture.inProcess.upgrades).toEqual([]);
  });
});
