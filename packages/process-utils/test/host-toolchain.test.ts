import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HostToolchain, execHostFile, spawnHostProcess } from "../src/index.js";

const roots: string[] = [];
async function scratch() {
  const root = await mkdtemp(join(tmpdir(), "bb-host-toolchain-"));
  roots.push(root);
  return root;
}
async function script(file: string, source: string) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
  await chmod(file, 0o755);
}
function run(
  toolchain: HostToolchain,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  const launch = toolchain.command(command, args, { env });
  return execFileSync(launch.command, launch.args, {
    env: launch.env,
    encoding: "utf8",
  });
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.skipIf(process.platform === "win32")("host toolchain recovery", () => {
  it("installs through Node-owned npm when a version-manager wrapper fails after installation", async () => {
    const root = await scratch();
    const bin = join(root, "node", "bin");
    const node = join(bin, "node");
    await mkdir(bin, { recursive: true });
    await symlink(process.execPath, node);
    const npmRoot = dirname(
      createRequire(import.meta.url).resolve("npm/package.json"),
    );
    const npmDestination = join(root, "node", "lib", "node_modules", "npm");
    await mkdir(dirname(npmDestination), { recursive: true });
    await symlink(npmRoot, npmDestination);
    const wrapper = join(bin, "npm");
    await script(
      wrapper,
      `#!/bin/sh\n"${node}" "${join(npmRoot, "bin", "npm-cli.js")}" "$@"\nexit 127\n`,
    );
    const pkg = join(root, "package");
    await mkdir(pkg);
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ name: "bb-toolchain-fixture", version: "1.0.0" }),
    );
    const env = {
      HOME: root,
      PATH: `${bin}:/usr/bin:/bin`,
      npm_config_update_notifier: "false",
    };
    const install = (prefix: string) => [
      "install",
      "-g",
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      pkg,
    ];
    const before = spawnSync(wrapper, install(join(root, "before")), {
      env,
      encoding: "utf8",
    });
    expect(before.status, before.stderr).toBe(127);
    const after = join(root, "after");
    run(new HostToolchain(env, node), "npm", install(after), env);
    const installed = JSON.parse(
      await readFile(
        join(
          after,
          "lib",
          "node_modules",
          "bb-toolchain-fixture",
          "package.json",
        ),
        "utf8",
      ),
    );
    expect(installed.version).toBe("1.0.0");
  });

  it("recovers a removed Homebrew Node path and advances the generation", async () => {
    const root = await scratch();
    const oldNode = join(root, "Cellar", "node@22", "old", "bin", "node");
    const newNode = join(root, "Cellar", "node@22", "new", "bin", "node");
    const stable = join(root, "opt", "node@22", "bin", "node");
    for (const node of [oldNode, newNode, stable])
      await mkdir(dirname(node), { recursive: true });
    await symlink(process.execPath, oldNode);
    await symlink(process.execPath, newNode);
    await symlink(newNode, stable);
    const env = { HOME: root, PATH: "/usr/bin:/bin", SHELL: "/bin/sh" };
    const toolchain = new HostToolchain(env, oldNode);
    expect(run(toolchain, oldNode, ["-p", "'before'"], env).trim()).toBe(
      "before",
    );
    const generation = toolchain.generation;
    await rm(oldNode);
    expect(spawnSync(oldNode, ["-v"]).error).toMatchObject({ code: "ENOENT" });
    expect(run(toolchain, oldNode, ["-p", "'after'"], env).trim()).toBe(
      "after",
    );
    expect(toolchain.generation).toBeGreaterThan(generation);
  });

  it("refreshes the login PATH when a command appears, preserving caller overrides", async () => {
    const root = await scratch();
    const bin = join(root, "new-bin");
    const shell = join(root, "shell");
    const shellPath = join(root, "shell-path");
    await writeFile(shellPath, "/usr/bin:/bin");
    await script(
      shell,
      `#!/bin/sh\nprintf 'startup noise\\n__BB_SHELL_ENV_START__\\nPATH='\n/bin/cat "${shellPath}"\nprintf '\\nHTTPS_PROXY=http://proxy.example:8080\\nIGNORED_SECRET=secret\\n__BB_SHELL_ENV_END__\\nshutdown noise\\n'\n`,
    );
    const env = { HOME: root, PATH: "/usr/bin:/bin", SHELL: shell };
    const toolchain = new HostToolchain(env);
    toolchain.refresh();
    await script(join(bin, "host-fixture"), "#!/bin/sh\nprintf found");
    await writeFile(shellPath, bin);
    expect(run(toolchain, "host-fixture", [], env)).toBe("found");
    expect(
      toolchain.environment({ ...env, HTTPS_PROXY: "http://override.example" }),
    ).toMatchObject({ HTTPS_PROXY: "http://override.example" });
    expect(toolchain.environment().IGNORED_SECRET).toBeUndefined();
    expect(toolchain.environment().HTTPS_PROXY).toBe(
      "http://proxy.example:8080",
    );
    await script(shell, "#!/bin/sh\nexit 1\n");
    toolchain.refresh();
    expect(run(toolchain, "host-fixture", [], env)).toBe("found");
  });

  it("finds native providers and runs the bb Node shebang with a minimal service PATH", async () => {
    const root = await scratch();
    const bb = join(root, "bb");
    const claude = join(root, ".local", "bin", "claude");
    await script(bb, "#!/usr/bin/env node\nconsole.log('bb works');\n");
    await script(claude, "#!/bin/sh\nprintf native-claude");
    const env = { HOME: root, PATH: "/usr/bin:/bin", BB_CLI: bb };
    const toolchain = new HostToolchain(env);
    expect(run(toolchain, "bb", [], env).trim()).toBe("bb works");
    expect(run(toolchain, "claude", [], env)).toBe("native-claude");
  });

  it("keeps execute-bit checks for explicit Node scripts and excludes relative bb discovery", async () => {
    const root = await scratch();
    const bb = join(root, "relative", "bb");
    const plain = join(root, "not-executable");
    await script(bb, "#!/usr/bin/env node\nconsole.log('wrong bb');\n");
    await script(plain, "#!/usr/bin/env node\nconsole.log('must not run');\n");
    await chmod(plain, 0o644);
    const env = {
      HOME: root,
      PATH: "relative",
      BB_CLI: "./relative/bb",
      BB_CLI_DIR: "relative",
      SHELL: "/bin/sh",
    };
    const toolchain = new HostToolchain(env);
    expect(toolchain.resolve("bb", { cwd: root, env })).not.toBe(bb);
    const launch = toolchain.command(plain, [], { env });
    expect(
      spawnSync(launch.command, launch.args, { env: launch.env }).error,
    ).toMatchObject({ code: "EACCES" });
  });

  it("bounds shell discovery and kills a shell that ignores SIGTERM", async () => {
    const root = await scratch();
    const shell = join(root, "stuck-shell");
    await script(
      shell,
      `#!${process.execPath}\nprocess.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n`,
    );
    const toolchain = new HostToolchain({
      HOME: root,
      PATH: "/usr/bin:/bin",
      SHELL: shell,
    });
    const started = Date.now();
    toolchain.refresh();
    expect(Date.now() - started).toBeLessThan(8000);
    expect(toolchain.environment().PATH?.split(delimiter)).toContain(
      "/usr/bin",
    );
  }, 10000);

  it("retains the last interactive PATH and does not repeatedly probe alternating missing commands", async () => {
    const root = await scratch();
    const shell = join(root, "shell");
    const calls = join(root, "calls");
    const env = { HOME: root, PATH: "/usr/bin:/bin", SHELL: shell };
    await script(
      shell,
      `#!/bin/sh\nprintf '__BB_SHELL_ENV_START__\\nPATH=/interactive-bin\\n__BB_SHELL_ENV_END__\\n'\n`,
    );
    const toolchain = new HostToolchain(env);
    toolchain.refresh();
    await script(
      shell,
      `#!/bin/sh\nprintf x >> "${calls}"\nif [ "$1" = '-ilc' ]; then exit 1; fi\nprintf '__BB_SHELL_ENV_START__\\nPATH=/wrong-fallback\\n__BB_SHELL_ENV_END__\\n'\n`,
    );
    for (const command of ["bb-missing-a", "bb-missing-b", "bb-missing-a"])
      expect(toolchain.resolve(command)).toBeNull();
    expect(await readFile(calls, "utf8")).toBe("x");
    expect(toolchain.environment().PATH?.split(delimiter)[0]).toBe(
      "/interactive-bin",
    );
  });

  it("does not replay a command that exits 127 after a side effect", async () => {
    const root = await scratch();
    const command = join(root, "side-effect");
    const output = join(root, "output");
    await script(command, `#!/bin/sh\nprintf x >> "${output}"\nexit 127\n`);
    await expect(execHostFile(command)).rejects.toMatchObject({ code: 127 });
    expect(await readFile(output, "utf8")).toBe("x");
  });
});

it.runIf(process.platform === "win32")(
  "launches command shims with spaces and metacharacters through both process APIs",
  async () => {
    const root = await scratch();
    const bin = join(root, "bin & tools");
    await script(join(bin, "tool.cmd"), "@echo off\r\necho %~1\r\n");
    const env = {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    };
    const argument = "hello & goodbye";
    expect(
      (await execHostFile("tool", [argument], { env })).stdout.trim(),
    ).toBe(argument);
    const child = spawnHostProcess("tool", [argument], { env });
    let stdout = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`exit ${code}`)),
      );
    });
    expect(stdout.trim()).toBe(argument);
  },
);
