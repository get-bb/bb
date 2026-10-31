import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

export async function smokePackagedPi(runtime, npmCli) {
  const root = await mkdtemp(join(tmpdir(), "bb-pi-runtime-"));
  let child;
  try {
    const env = {
      HOME: root,
      USERPROFILE: root,
      PATH: "",
      ELECTRON_RUN_AS_NODE: "1",
      SystemRoot: process.env.SystemRoot,
      TMP: root,
      TEMP: root,
      TMPDIR: root,
      npm_config_cache: join(root, "cache"),
    };
    const exec = promisify(execFile);
    await exec(
      runtime,
      [
        npmCli,
        "install",
        "--prefix",
        root,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "@earendil-works/pi-coding-agent@latest",
      ],
      { env, cwd: root, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const packageDir = join(
      root,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
    );
    const manifest = JSON.parse(
      await readFile(join(packageDir, "package.json"), "utf8"),
    );
    const entry = resolve(packageDir, manifest.bin.pi);
    const version = await exec(runtime, [entry, "--version"], {
      env,
      cwd: root,
      timeout: 30_000,
    });
    assert(version.stdout.includes(manifest.version));
    child = spawn(runtime, [entry, "--mode", "rpc", "--no-session"], {
      env,
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Pi did not answer RPC using bundled Electron")),
        30_000,
      );
      let output = "";
      child.on("error", reject);
      child.on("exit", () => {
        clearTimeout(timer);
        reject(new Error("Pi exited before answering RPC"));
      });
      child.stdout.on("data", (data) => {
        output += data;
        for (const line of output.split("\n").slice(0, -1)) {
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message.id !== "smoke") continue;
          clearTimeout(timer);
          if (!message.success)
            reject(new Error("Pi RPC failed using bundled Electron"));
          else resolve();
        }
      });
      child.stdin.write(
        JSON.stringify({ id: "smoke", type: "get_state" }) + "\n",
      );
    });
    console.log(
      "Pi installation, version and RPC passed with packaged Electron and empty PATH",
    );
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 500,
    });
  }
}
