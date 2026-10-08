import { expect, it, vi } from "vitest";
import { captureBridgeJsonRpcOutput } from "./bridge-json-rpc-test-helpers.js";

it("captures split UTF8 records and completes each intercepted write", async () => {
  const output = captureBridgeJsonRpcOutput();
  const callback = vi.fn();
  const message = { jsonrpc: "2.0", id: 1, result: "🌈漢字" };
  const bytes = Buffer.from(JSON.stringify(message) + "\n");
  const split = bytes.indexOf(Buffer.from("🌈")) + 1;
  try {
    process.stdout.write(bytes.subarray(0, split), callback);
    expect(output.messages).toEqual([]);
    process.stdout.write(bytes.subarray(split), "utf8", callback);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(callback).toHaveBeenCalledTimes(2);
    expect(output.takeMessages()).toEqual([message]);
    expect(output.takeMessages()).toEqual([]);
  } finally {
    output.restore();
  }
});
