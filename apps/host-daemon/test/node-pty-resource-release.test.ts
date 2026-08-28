import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const probe = `
import { execFileSync } from "node:child_process";
import { spawn } from "node-pty";

const countOpenPtyMasters = () =>
  execFileSync(
    "/usr/sbin/lsof",
    ["-Fn", "-a", "-p", String(process.pid)],
    { encoding: "utf8" },
  )
    .split("\\n")
    .filter((line) => line === "n/dev/ptmx").length;

const before = countOpenPtyMasters();
const pty = spawn("/usr/bin/true", [], {
  cols: 80,
  cwd: process.cwd(),
  env: process.env,
  name: "xterm-256color",
  rows: 24,
});

await new Promise((resolve) => pty.onExit(resolve));
pty.destroy();
console.log(countOpenPtyMasters() - before);
`;

describe.skipIf(process.platform !== "darwin")(
  "node-pty resource release",
  () => {
    it("closes the PTY master after the child exits", async () => {
      const { stdout } = await execFileAsync(
        process.execPath,
        ["--input-type=module", "--eval", probe],
        { cwd: import.meta.dirname },
      );

      expect(stdout.trim()).toBe("0");
    });
  },
);
