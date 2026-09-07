import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createModalBackend,
  createSandboxExecutor,
} from "./sandbox-backend.js";

const vendor = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("modal", () => ({
  NotFoundError: class extends Error {},
  ModalClient: class {
    sandboxes = {
      fromId: async () => ({ sandboxId: "sandbox-1", exec: vendor.exec }),
    };
  },
}));

async function executor() {
  const sandbox = await createModalBackend({
    tokenId: "id",
    tokenSecret: "secret",
  }).fromId("sandbox-1");
  if (sandbox === null) throw new Error("missing sandbox");
  return createSandboxExecutor(sandbox);
}

function processResult() {
  return {
    stdin: {
      writeText: vi.fn(async (_value: string) => {}),
      close: vi.fn(async () => {}),
    },
    stdout: { readText: vi.fn(async () => "output") },
    stderr: { readText: vi.fn(async () => "error") },
    wait: vi.fn(async () => 7),
  };
}

beforeEach(() => vendor.exec.mockReset());

describe("Modal bootstrap executor", () => {
  it("delivers stdin without putting credentials into command arguments and closes input", async () => {
    const process = processResult();
    vendor.exec.mockResolvedValue(process);
    const transport = await executor();
    await expect(
      transport.exec({
        command: ["bb", "machine", "enroll"],
        timeoutMs: 1234,
        signal: new AbortController().signal,
        stdin: "credential-secret",
      }),
    ).resolves.toEqual({ exitCode: 7, stdout: "output", stderr: "error" });
    expect(vendor.exec).toHaveBeenCalledWith(["bb", "machine", "enroll"], {
      mode: "text",
      stdout: "pipe",
      stderr: "pipe",
      timeoutMs: 1234,
    });
    expect(process.stdin.writeText).toHaveBeenCalledWith("credential-secret");
    expect(process.stdin.close).toHaveBeenCalledOnce();
  });

  it("closes stdin when no input is supplied or input delivery fails", async () => {
    const process = processResult();
    vendor.exec.mockResolvedValue(process);
    const transport = await executor();
    const request = {
      command: ["true"],
      timeoutMs: 1000,
      signal: new AbortController().signal,
    };
    await transport.exec(request);
    expect(process.stdin.writeText).not.toHaveBeenCalled();
    expect(process.stdin.close).toHaveBeenCalledOnce();
    process.stdin.writeText.mockRejectedValueOnce(new Error("write failed"));
    await expect(
      transport.exec({ ...request, stdin: "secret" }),
    ).rejects.toThrow("write failed");
    expect(process.stdin.close).toHaveBeenCalledTimes(2);
  });

  it("does not submit cancelled commands and stops waiting for in-flight commands", async () => {
    const controller = new AbortController();
    const transport = await executor();
    const request = {
      command: ["sleep", "60"],
      timeoutMs: 1000,
      signal: controller.signal,
    };
    const process = processResult();
    let finish: (value: string) => void = () => {};
    process.stdout.readText.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    vendor.exec.mockResolvedValue(process);
    const pending = transport.exec(request);
    await vi.waitFor(() =>
      expect(process.stdout.readText).toHaveBeenCalledOnce(),
    );
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    await expect(transport.exec(request)).rejects.toThrow("cancelled");
    expect(vendor.exec).toHaveBeenCalledOnce();
    finish("finished");
  });
});
