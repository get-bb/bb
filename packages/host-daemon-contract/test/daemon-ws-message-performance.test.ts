/// <reference types="node" />
import { threadCpuUsage } from "node:process";
import { describe, expect, it } from "vitest";
import {
  hostDaemonDaemonWsMessageSchema,
  hostDaemonOnlineRpcResponseMessageSchema,
} from "../src/index.js";

function cpuUsPerParse(parse: () => unknown): number {
  parse();
  let fastest = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < 3; sample += 1) {
    const started = threadCpuUsage();
    let parses = 0;
    let elapsedCpuUs = 0;
    do {
      for (let repeat = 0; repeat < 256; repeat += 1) {
        parse();
      }
      parses += 256;
      const cpu = threadCpuUsage(started);
      elapsedCpuUs = cpu.user + cpu.system;
    } while (elapsedCpuUs < 50_000);
    fastest = Math.min(fastest, elapsedCpuUs / parses);
  }
  return fastest;
}

const lastMessageTypeCases = [
  {
    name: "a failed host-rpc.response",
    message: {
      type: "host-rpc.response",
      requestId: "request-1",
      commandType: "host.list_files",
      ok: false,
      errorCode: "not_found",
      errorMessage: "Missing directory",
    },
  },
  {
    name: "a successful host-rpc.response",
    message: {
      type: "host-rpc.response",
      requestId: "request-1",
      commandType: "host.read_file_chunk",
      ok: true,
      result: {
        path: "/tmp/clip.mp4",
        sizeBytes: 5,
        modifiedAtMs: 1,
        mimeType: "video/mp4",
        revision: "a".repeat(64),
        offset: 0,
        content: new Uint8Array([0, 1, 2, 250, 255]),
      },
    },
  },
];

describe("daemon websocket message dispatch", () => {
  it.each(lastMessageTypeCases)(
    "parses $name about as fast as its own schema",
    ({ message }) => {
      expect(hostDaemonDaemonWsMessageSchema.parse(message)).toEqual(message);

      const viaMessageSchemaCpuUs = cpuUsPerParse(() =>
        hostDaemonDaemonWsMessageSchema.parse(message),
      );
      const viaMemberSchemaCpuUs = cpuUsPerParse(() =>
        hostDaemonOnlineRpcResponseMessageSchema.parse(message),
      );

      expect(viaMessageSchemaCpuUs).toBeLessThan(viaMemberSchemaCpuUs * 4);
    },
  );
});
