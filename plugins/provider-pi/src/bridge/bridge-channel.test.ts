import { connect, type Socket } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import {
  PI_BRIDGE_CHANNEL_ENV,
  PI_BRIDGE_CHANNEL_TOKEN_ENV,
  PiBridgeChannel,
} from "./bridge-channel.js";

const channels: PiBridgeChannel[] = [];
const sockets: Socket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const channel of channels.splice(0)) channel.close();
});

function open(): { channel: PiBridgeChannel; lines: string[] } {
  const lines: string[] = [];
  const channel = new PiBridgeChannel({
    onLine: (line) => lines.push(line),
    onOverflow: () => undefined,
    onError: (error) => {
      throw error;
    },
  });
  channels.push(channel);
  return { channel, lines };
}

function dial(
  channel: PiBridgeChannel,
  firstLine: string,
): {
  socket: Socket;
  received: () => string;
  closed: Promise<void>;
} {
  const socket = connect(channel.env[PI_BRIDGE_CHANNEL_ENV]);
  sockets.push(socket);
  let received = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    received += chunk;
  });
  socket.on("error", () => undefined);
  const closed = new Promise<void>((resolve) => socket.once("close", resolve));
  socket.write(`${firstLine}\n`);
  return { socket, received: () => received, closed };
}

it("serves only the connection that presents the token", async () => {
  const { channel, lines } = open();
  channel.write('{"kind":"request","id":"early"}\n');

  const stranger = dial(channel, "not-the-token");
  stranger.socket.write('{"kind":"tool-call","id":"forged"}\n');
  await stranger.closed;
  expect(stranger.received()).toBe("");

  const extension = dial(channel, channel.env[PI_BRIDGE_CHANNEL_TOKEN_ENV]);
  await vi.waitFor(() =>
    expect(extension.received()).toBe('{"kind":"request","id":"early"}\n'),
  );
  extension.socket.write('{"kind":"ready"}\n');
  await vi.waitFor(() => expect(lines).toEqual(['{"kind":"ready"}']));
});
