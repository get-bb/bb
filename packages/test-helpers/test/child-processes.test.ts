import { spawn } from "node:child_process";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  createDescendantPipe,
  createProcessLifeline,
  hasExited,
  trackChildProcesses,
  waitForExit,
} from "../src/child-processes.js";

const idle = "setInterval(() => {}, 1000);";

describe("trackChildProcesses", () => {
  it("observes children spawned anywhere in this process until disposed", async () => {
    const tracker = trackChildProcesses();
    onTestFinished(() => tracker.dispose());
    const first = spawn(process.execPath, ["-e", idle], { stdio: "ignore" });
    expect(tracker.children).toEqual([first]);
    expect(tracker.running()).toEqual([first]);

    first.kill("SIGKILL");
    await tracker.waitForExit();
    expect(hasExited(first)).toBe(true);
    expect(tracker.running()).toEqual([]);

    tracker.dispose();
    const untracked = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await waitForExit(untracked);
    expect(tracker.children).toEqual([first]);
  });

  it("reaps children a test left running", async () => {
    const tracker = trackChildProcesses();
    onTestFinished(() => tracker.dispose());
    const child = spawn(process.execPath, ["-e", idle], { stdio: "ignore" });

    tracker.killRunning();
    await waitForExit(child);

    expect(hasExited(child)).toBe(true);
  });

  it("waits for a child's stdio to close after it exits", async () => {
    const tracker = trackChildProcesses();
    onTestFinished(() => tracker.dispose());
    const child = spawn(process.execPath, [
      "-e",
      "process.stdout.write('done')",
    ]);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });

    await tracker.waitForClose();

    expect(hasExited(child)).toBe(true);
    expect(output).toBe("done");
  });

  it("rejects instead of hanging when the command cannot start", async () => {
    const child = spawn("bb-test-command-that-does-not-exist", {
      stdio: "ignore",
    });

    await expect(waitForExit(child)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("createProcessLifeline", () => {
  it("reports a descendant's exit through its connection", async () => {
    const lifeline = await createProcessLifeline();
    onTestFinished(() => lifeline.close());
    const parent = spawn(
      process.execPath,
      [
        "-e",
        `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(
          `${lifeline.holdSource("grandchild")}${idle}`,
        )}], { stdio: "ignore" }); ${idle}`,
      ],
      { stdio: "ignore" },
    );
    onTestFinished(() => {
      parent.kill("SIGKILL");
    });

    const [grandchild] = await lifeline.waitForHolders(1);
    expect(grandchild?.label).toBe("grandchild");
    expect(grandchild?.alive()).toBe(true);

    expect(grandchild?.kill()).toBe(true);
    await grandchild?.exited;

    expect(grandchild?.alive()).toBe(false);
    expect(grandchild?.kill()).toBe(false);
  });

  it("runs the onHeld statement only after the holder is registered", async () => {
    const lifeline = await createProcessLifeline();
    onTestFinished(() => lifeline.close());
    const child = spawn(
      process.execPath,
      [
        "-e",
        lifeline.holdSource(
          "blocking",
          'process.stdout.write("held"); require("node:child_process").execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 300_000)"]);',
        ),
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    onTestFinished(() => {
      child.kill("SIGKILL");
    });
    const output = await new Promise<string>((resolveOutput) =>
      child.stdout.once("data", (chunk) => resolveOutput(String(chunk))),
    );

    expect(output).toBe("held");
    expect(lifeline.holders.map((holder) => holder.label)).toEqual([
      "blocking",
    ]);
  });

  it("reports exit even when the reported PID now belongs to a live process", async () => {
    const lifeline = await createProcessLifeline();
    onTestFinished(() => lifeline.close());
    const bystander = spawn(process.execPath, ["-e", idle], {
      stdio: "ignore",
    });
    onTestFinished(() => {
      bystander.kill("SIGKILL");
    });
    const recycledPid = bystander.pid;
    if (recycledPid === undefined) throw new Error("bystander did not start");
    const holder = spawn(
      process.execPath,
      [
        "-e",
        `const s = require("node:net").connect(${JSON.stringify(lifeline.path)}); s.write(JSON.stringify({ label: "recycled", pid: ${recycledPid} }) + "\\n"); process.stdin.once("data", () => process.exit(0));`,
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );

    const [recycled] = await lifeline.waitForHolders(1);
    holder.stdin.write("exit\n");
    await recycled?.exited;

    expect(hasExited(bystander)).toBe(false);
    expect(recycled?.alive()).toBe(false);
    expect(recycled?.kill()).toBe(false);
  });

  it("kills holders that outlive the test when closed", async () => {
    const lifeline = await createProcessLifeline();
    const holder = spawn(
      process.execPath,
      [
        "-e",
        `process.on("SIGTERM", () => {}); ${lifeline.holdSource("stubborn")}${idle}`,
      ],
      { stdio: "ignore" },
    );
    await lifeline.waitForHolders(1);

    await lifeline.close();
    await waitForExit(holder);

    expect(hasExited(holder)).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("createDescendantPipe", () => {
  it("closes once every shell descendant writing to it has exited", async () => {
    const pipe = await createDescendantPipe();
    onTestFinished(() => pipe.dispose());
    const shell = spawn(
      "sh",
      ["-c", `sleep 300 > "$1" & read _; kill $!; wait`, "sh", pipe.path],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    onTestFinished(() => {
      shell.kill("SIGKILL");
    });
    let settled = false;
    void pipe.closed.then(() => {
      settled = true;
    });
    await pipe.opened;
    expect(settled).toBe(false);

    shell.stdin.end("\n");
    await pipe.closed;

    expect(settled).toBe(true);
  });

  it("releases its reader when no descendant ever opened it", async () => {
    const pipe = await createDescendantPipe();

    await pipe.dispose();

    await expect(pipe.closed).resolves.toBeUndefined();
  });
});
