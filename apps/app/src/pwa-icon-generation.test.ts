import { execFile, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);

it("checks generated icons during generation and rejects stale assets", async () => {
  const appDir = resolve(import.meta.dirname, "..");
  const fixture = await mkdtemp(join(tmpdir(), "bb-pwa-icons-"));
  try {
    await mkdir(join(fixture, "scripts"));
    await cp(join(appDir, "public"), join(fixture, "public"), {
      recursive: true,
    });
    const generator = join(fixture, "scripts/generate-pwa-icons.mjs");
    await cp(join(appDir, "scripts/generate-pwa-icons.mjs"), generator);
    await symlink(
      join(appDir, "node_modules"),
      join(fixture, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const preload = join(fixture, "pause-write.mjs");
    await writeFile(
      preload,
      `
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const write = fs.writeFile;
fs.writeFile = async (path, content, ...rest) => {
  if (String(path).endsWith("icon-monochrome-192.png")) {
    await write(path, Buffer.alloc(0));
    process.stdout.write("write-paused\\n");
    await new Promise(resolve => process.stdin.once("data", resolve));
  }
  return write(path, content, ...rest);
};
syncBuiltinESMExports();
`,
    );
    const writer = spawn(
      process.execPath,
      ["--import", pathToFileURL(preload).href, generator],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stderr = "";
    writer.stderr.on("data", (data) => {
      stderr += data;
    });
    const completed = new Promise<void>((resolve, reject) => {
      writer.once("error", reject);
      writer.once("exit", (code) => {
        if (code === 0) resolve();
        else
          reject(new Error(`Icon generation exited with ${code}: ${stderr}`));
      });
    });
    const paused = new Promise<void>((resolve) => {
      let stdout = "";
      writer.stdout.on("data", (data) => {
        stdout += data;
        if (stdout.includes("write-paused")) resolve();
      });
    });
    try {
      await Promise.race([completed, paused]);
      await execFileAsync(process.execPath, [generator, "--check"]);
    } finally {
      if (writer.exitCode === null && writer.signalCode === null) {
        writer.stdin.end("resume\n");
      }
      await completed;
    }

    await writeFile(
      join(fixture, "public/icon-monochrome-192.png"),
      "stale asset",
    );
    await expect(
      execFileAsync(process.execPath, [generator, "--check"]),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("icon-monochrome-192.png"),
    });
    await execFileAsync(process.execPath, [generator]);
    await execFileAsync(process.execPath, [generator, "--check"]);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 30_000);
