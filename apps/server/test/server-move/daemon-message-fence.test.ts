import {
  hostDaemonDaemonWsMessageSchema,
  type HostDaemonDaemonWsMessage,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { SERVER_MOVE_FENCED_DAEMON_MESSAGE_TYPES } from "../../src/ws/daemon-protocol.js";

type DaemonMessageType = HostDaemonDaemonWsMessage["type"];

const SNAPSHOT_FENCE_CLASSIFICATION: Record<
  DaemonMessageType,
  "fenced" | "unfenced"
> = {
  "connect-tunnel.identity": "unfenced",
  "desktop-browser.changed": "fenced",
  "environment-change": "unfenced",
  "environment-metadata-change": "fenced",
  "environment.hook.progress": "unfenced",
  heartbeat: "unfenced",
  "host-rpc.response": "unfenced",
  "machine.shutdown-ack": "unfenced",
  "plugin-host.signal": "fenced",
  "plugin-host.worker-exited": "fenced",
  "server_move.progress": "unfenced",
  "terminal.error": "unfenced",
  "terminal.exited": "fenced",
  "terminal.opened": "fenced",
  "terminal.output": "unfenced",
  "terminal.replay": "unfenced",
};

interface MessageSchemaNode {
  readonly options?: readonly MessageSchemaNode[];
  readonly shape?: { readonly type?: { readonly value?: unknown } };
}

function collectMessageTypes(node: MessageSchemaNode, types: Set<unknown>) {
  if (node.options !== undefined) {
    for (const option of node.options) {
      collectMessageTypes(option, types);
    }
    return;
  }
  types.add(node.shape?.type?.value);
}

describe("server move snapshot fence", () => {
  it("classifies every daemon message type as fenced or deliberately unfenced", () => {
    const messageTypes = new Set<unknown>();
    collectMessageTypes(hostDaemonDaemonWsMessageSchema, messageTypes);

    expect([...messageTypes].sort()).toEqual(
      Object.keys(SNAPSHOT_FENCE_CLASSIFICATION).sort(),
    );
    expect([...SERVER_MOVE_FENCED_DAEMON_MESSAGE_TYPES].sort()).toEqual(
      Object.entries(SNAPSHOT_FENCE_CLASSIFICATION)
        .filter(([, fence]) => fence === "fenced")
        .map(([type]) => type)
        .sort(),
    );
  });
});
