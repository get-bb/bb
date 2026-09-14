import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { posixCommand } from "./posix-quote.js";
import {
  buildSshArgs,
  createSshExecutor,
  type SshChildProcess,
} from "./ssh-executor.js";
import type { SshTarget } from "./target.js";

const target: SshTarget = {
  destination: "ubuntu@sandbox",
  port: 2222,
  sshPath: "/usr/bin/ssh",
  identityFile: "/tmp/id_ed25519",
  knownHosts: "accept-new",
  connectTimeoutSeconds: 15,
};

class FakeStream extends EventEmitter {
  on(event: "data", listener: (chunk: Buffer | string) => void): this {
    super.on(event, listener);
    return this;
  }
}

class FakeChild extends EventEmitter {
  stdinChunks: string[] = [];
  killed: NodeJS.Signals | undefined;
  readonly stdin = {
    write: (chunk: string): boolean => {
      this.stdinChunks.push(chunk);
      return true;
    },
    end: (): void => {},
  };
  readonly stdout = new FakeStream() as unknown as SshChildProcess["stdout"];
  readonly stderr = new FakeStream() as unknown as SshChildProcess["stderr"];

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = signal;
    return true;
  }
}

describe("SSH executor argv", () => {
  it("never puts stdin credentials into argv and quotes the remote command", () => {
    const command = ["sh", "-c", "cat >/tmp/x", "bb-machine-install"];
    const args = buildSshArgs(target, command);
    expect(args).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=15",
      "-o",
      "IdentitiesOnly=yes",
      "-i",
      "/tmp/id_ed25519",
      "-p",
      "2222",
      "ubuntu@sandbox",
      "--",
      posixCommand(command),
    ]);
    expect(args.join(" ")).not.toContain("BEGIN");
  });

  it("omits identity and port flags when they are unset", () => {
    expect(
      buildSshArgs({ ...target, identityFile: null, port: undefined }, [
        "true",
      ]),
    ).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=15",
      "ubuntu@sandbox",
      "--",
      "'true'",
    ]);
  });
});

describe("SSH executor IO", () => {
  it("forwards stdin privately and streams stdout and stderr", async () => {
    const child = new FakeChild();
    const output: string[] = [];
    const exec = createSshExecutor(target, () => child).exec({
      command: ["true"],
      stdin: "bootstrap-secret",
      timeoutMs: 5_000,
      signal: new AbortController().signal,
      onOutput(chunk) {
        output.push(chunk);
      },
    });
    (child.stdout as unknown as EventEmitter).emit("data", "hello ");
    (child.stderr as unknown as EventEmitter).emit("data", "warn\n");
    child.emit("close", 0, null);
    await expect(exec).resolves.toEqual({ exitCode: 0 });
    expect(child.stdinChunks).toEqual(["bootstrap-secret"]);
    expect(output.join("")).toContain("hello ");
  });

  it("kills the process on timeout", async () => {
    const child = new FakeChild();
    const exec = createSshExecutor(target, () => child).exec({
      command: ["sleep"],
      stdin: "",
      timeoutMs: 20,
      signal: new AbortController().signal,
      onOutput() {},
    });
    await expect(exec).rejects.toThrow("timed out");
    expect(child.killed).toBe("SIGKILL");
  });
});
