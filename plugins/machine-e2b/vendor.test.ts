import { CommandExitError } from "e2b";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVendor } from "./vendor.js";

const sdk = vi.hoisted(() => ({
  run: vi.fn(),
  create: vi.fn(),
  connect: vi.fn(),
  list: vi.fn(),
  pause: vi.fn(),
  kill: vi.fn(),
}));
vi.mock("e2b", () => ({
  Sandbox: sdk,
  CommandExitError: class extends Error {
    constructor(
      readonly result: { exitCode: number; stdout: string; stderr: string },
    ) {
      super("command failed");
    }
    get exitCode() {
      return this.result.exitCode;
    }
    get stdout() {
      return this.result.stdout;
    }
    get stderr() {
      return this.result.stderr;
    }
  },
}));
function command() {
  return {
    sendStdin: vi.fn(async () => {}),
    closeStdin: vi.fn(async () => {}),
    wait: vi.fn(async () => ({ exitCode: 0, stdout: "out", stderr: "err" })),
    kill: vi.fn(async () => true),
    disconnect: vi.fn(async () => {}),
  };
}
beforeEach(() => {
  for (const mock of Object.values(sdk)) mock.mockReset();
  sdk.connect.mockResolvedValue({
    sandboxId: "sandbox-1",
    commands: { run: sdk.run },
  });
});

describe("E2B SDK adapter", () => {
  it("quotes argv, sends private stdin, closes it, and applies remote timeout/root user", async () => {
    const process = command();
    sdk.run.mockResolvedValue(process);
    const signal = new AbortController().signal;
    const handle = await createVendor("api-secret").connect(
      "sandbox-1",
      60_000,
      signal,
    );
    await expect(
      handle.executor.exec({
        command: ["bb", "it's $(id)"],
        timeoutMs: 1234,
        signal,
        stdin: "credential-secret",
      }),
    ).resolves.toEqual({ exitCode: 0, stdout: "out", stderr: "err" });
    expect(sdk.run).toHaveBeenCalledWith(
      "'timeout' '--kill-after=1s' '1.234s' 'bb' 'it'\\''s $(id)'",
      expect.objectContaining({
        background: true,
        stdin: true,
        user: "root",
        timeoutMs: 3234,
        signal,
      }),
    );
    expect(process.sendStdin).toHaveBeenCalledWith(
      "credential-secret",
      expect.objectContaining({ signal }),
    );
    expect(process.closeStdin).toHaveBeenCalledOnce();
    expect(process.disconnect).toHaveBeenCalledOnce();
  });
  it("returns nonzero exit status and kills a command when stdin delivery fails", async () => {
    const process = command();
    sdk.run.mockResolvedValue(process);
    const signal = new AbortController().signal;
    const handle = await createVendor("key").connect(
      "sandbox-1",
      60_000,
      signal,
    );
    const request = { command: ["false"], timeoutMs: 1000, signal };
    process.wait.mockRejectedValueOnce(
      new CommandExitError({ exitCode: 2, stdout: "", stderr: "failed" }),
    );
    expect(await handle.executor.exec(request)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "failed",
    });
    process.sendStdin.mockRejectedValueOnce(new Error("delivery failed"));
    await expect(
      handle.executor.exec({ ...request, stdin: "secret" }),
    ).rejects.toThrow("delivery failed");
    expect(process.kill).toHaveBeenCalledOnce();
  });
  it("kills the command after cancellation and rejects cancelled commands before submission", async () => {
    const process = command();
    sdk.run.mockResolvedValue(process);
    const controller = new AbortController();
    process.wait.mockImplementationOnce(async () => {
      controller.abort(new Error("cancelled"));
      throw controller.signal.reason;
    });
    const handle = await createVendor("key").connect(
      "sandbox-1",
      60_000,
      controller.signal,
    );
    const request = {
      command: ["sleep", "60"],
      timeoutMs: 1000,
      signal: controller.signal,
    };
    await expect(handle.executor.exec(request)).rejects.toThrow("cancelled");
    await expect(handle.executor.exec(request)).rejects.toThrow("cancelled");
    expect(process.kill).toHaveBeenCalledOnce();
    expect(sdk.run).toHaveBeenCalledOnce();
  });
  it("includes paused sandboxes in metadata discovery and rejects multiple matches across pages", async () => {
    let page = 0;
    sdk.list.mockReturnValue({
      get hasNext() {
        return page < 2;
      },
      async nextItems() {
        page += 1;
        return [
          { sandboxId: `sandbox-${page}`, metadata: { bbMachineKey: "key" } },
        ];
      },
    });
    await expect(
      createVendor("key").find("key", new AbortController().signal),
    ).rejects.toThrow("Multiple");
    expect(sdk.list).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          metadata: { bbMachineKey: "key" },
          state: ["running", "paused"],
        },
      }),
    );
  });
});
