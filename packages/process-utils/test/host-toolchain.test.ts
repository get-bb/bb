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
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HostToolchain,
  execHostFile,
  execHostFileBuffer,
  spawnHostProcess,
} from "../src/index.js";

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
    const toolchain = new HostToolchain(env, node);
    const npm =
      toolchain.npmCli("npm", { env }) ?? expect.fail("npm was not found");
    run(toolchain, npm.node, [npm.cli, ...install(after)], env);
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
  }, 30_000);

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
    await rm(oldNode);
    expect(spawnSync(oldNode, ["-v"]).error).toMatchObject({ code: "ENOENT" });
    expect(run(toolchain, oldNode, ["-p", "'after'"], env).trim()).toBe(
      "after",
    );
  });

  it("refreshes the login PATH when a command appears, preserving caller overrides", async () => {
    const root = await scratch();
    const bin = join(root, "new-bin");
    const shell = join(root, "shell");
    const shellPath = join(root, "shell-path");
    await writeFile(shellPath, "/usr/bin:/bin");
    await script(
      shell,
      `#!/bin/sh\nprintf 'startup noise\\n__BB_SHELL_ENV_START__\\nPATH='\n/bin/cat "${shellPath}"\nprintf '\\nHTTPS_PROXY=http://proxy.example:8080\\nhttps_proxy=http://proxy.example:8080\\nIGNORED_SECRET=secret\\n__BB_SHELL_ENV_END__\\nshutdown noise\\n'\n`,
    );
    const env = { HOME: root, PATH: "/usr/bin:/bin", SHELL: shell };
    const toolchain = new HostToolchain(env);
    await toolchain.refresh();
    await script(join(bin, "host-fixture"), "#!/bin/sh\nprintf found");
    await writeFile(shellPath, bin);
    expect(toolchain.resolve("host-fixture", { env })).toBeNull();
    await toolchain.refresh();
    expect(run(toolchain, "host-fixture", [], env)).toBe("found");
    expect(
      toolchain.environment({ ...env, HTTPS_PROXY: "http://override.example" }),
    ).toMatchObject({ HTTPS_PROXY: "http://override.example" });
    expect(
      toolchain.environment({ ...env, HTTPS_PROXY: "http://override.example" })
        .https_proxy,
    ).toBeUndefined();
    expect(
      toolchain.environment({ ...env, https_proxy: "http://override.example" })
        .HTTPS_PROXY,
    ).toBeUndefined();
    expect(toolchain.environment().IGNORED_SECRET).toBeUndefined();
    expect(toolchain.environment().HTTPS_PROXY).toBe(
      "http://proxy.example:8080",
    );
    await script(shell, "#!/bin/sh\nexit 1\n");
    await toolchain.refresh();
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
    await toolchain.refresh();
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
    await toolchain.refresh();
    await script(
      shell,
      `#!/bin/sh\nprintf x >> "${calls}"\nif [ "$1" = '-ilc' ]; then exit 1; fi\nprintf '__BB_SHELL_ENV_START__\\nPATH=/wrong-fallback\\n__BB_SHELL_ENV_END__\\n'\n`,
    );
    for (const command of ["bb-missing-a", "bb-missing-b", "bb-missing-a"])
      expect(toolchain.resolve(command)).toBeNull();
    await toolchain.refresh();
    expect(await readFile(calls, "utf8")).toBe("x");
    expect(toolchain.environment().PATH?.split(delimiter)[0]).toBe(
      "/interactive-bin",
    );
  });

  it("does not block the caller while discovery runs", async () => {
    const root = await scratch();
    const shell = join(root, "slow-shell");
    await script(
      shell,
      "#!/bin/sh\nsleep 1\nprintf '__BB_SHELL_ENV_START__\\nPATH=/slow-bin\\n__BB_SHELL_ENV_END__\\n'\n",
    );
    const toolchain = new HostToolchain({
      HOME: root,
      PATH: "/usr/bin:/bin",
      SHELL: shell,
    });
    const started = Date.now();
    const refresh = toolchain.refresh();
    toolchain.invalidateFailure(127);
    expect(toolchain.resolve("bb-missing-command")).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
    await refresh;
    expect(toolchain.environment().PATH?.split(delimiter)[0]).toBe("/slow-bin");
  });

  it("keeps a caller's PATH entries first and adds the standard folders after them", () => {
    const toolchain = new HostToolchain({ HOME: "/home/me", PATH: "/usr/bin" });
    const path = toolchain
      .environment({ HOME: "/home/me", PATH: "/review-toolchain:/bin" })
      .PATH?.split(delimiter);
    expect(path?.slice(0, 2)).toEqual(["/review-toolchain", "/bin"]);
    expect(path).toContain("/home/me/.local/bin");
  });

  it("finds a tool in a standard folder when the caller's PATH lacks it", async () => {
    const root = await scratch();
    const tool = join(root, ".local", "bin", "host-fixture");
    await script(tool, "#!/bin/sh\nprintf found");
    const env = { HOME: root, PATH: join(root, "empty") };
    const toolchain = new HostToolchain({ HOME: root, PATH: "/usr/bin:/bin" });
    expect(toolchain.resolve("host-fixture", { env })).toBe(tool);
    expect(run(toolchain, "host-fixture", [], env)).toBe("found");
  });

  it("launches Node shebang scripts directly instead of through the bb runtime", async () => {
    const root = await scratch();
    const tool = join(root, "bin", "node-tool");
    await script(tool, "#!/usr/bin/env node\nconsole.log('tool');\n");
    const env = { HOME: root, PATH: `${join(root, "bin")}:/usr/bin:/bin` };
    const launch = new HostToolchain(env, join(root, "Electron")).command(
      "node-tool",
      ["--flag"],
      { env },
    );
    expect(launch).toMatchObject({ command: tool, args: ["--flag"] });
  });

  it("adds the runtime directory to PATH only for a Node runtime", async () => {
    const root = await scratch();
    const app = join(root, "bb.app", "Contents", "MacOS", "bb");
    const node = join(root, "node", "bin", "node");
    await mkdir(dirname(app), { recursive: true });
    await mkdir(dirname(node), { recursive: true });
    await symlink(process.execPath, app);
    await symlink(process.execPath, node);
    const env = { HOME: root, PATH: "/usr/bin:/bin" };
    expect(
      new HostToolchain(env, app).environment(env).PATH?.split(":"),
    ).not.toContain(dirname(app));
    expect(
      new HostToolchain(env, node).environment(env).PATH?.split(":"),
    ).toContain(dirname(node));
  });

  it("runs an installed npm with the Node that owns it", async () => {
    const root = await scratch();
    const runtime = join(root, "runtime", "bin", "node");
    await mkdir(dirname(runtime), { recursive: true });
    await symlink(process.execPath, runtime);
    const prefix = join(root, "user-node");
    const npmRoot = dirname(
      createRequire(import.meta.url).resolve("npm/package.json"),
    );
    await mkdir(join(prefix, "bin"), { recursive: true });
    await mkdir(join(prefix, "lib", "node_modules"), { recursive: true });
    await symlink(process.execPath, join(prefix, "bin", "node"));
    await symlink(npmRoot, join(prefix, "lib", "node_modules", "npm"));
    await symlink(
      join(prefix, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
      join(prefix, "bin", "npm"),
    );
    const env = { HOME: root, PATH: `${join(prefix, "bin")}:/usr/bin:/bin` };
    expect(new HostToolchain(env, runtime).npmCli("npm", { env })).toEqual({
      node: realpathSync(process.execPath),
      cli: realpathSync(join(npmRoot, "bin", "npm-cli.js")),
    });
  });

  it("runs the npm on PATH instead of the runtime's own", async () => {
    const root = await scratch();
    const runtime = join(root, "runtime", "bin", "node");
    await mkdir(join(root, "runtime", "lib", "node_modules"), {
      recursive: true,
    });
    await mkdir(dirname(runtime), { recursive: true });
    await symlink(process.execPath, runtime);
    await symlink(
      dirname(createRequire(import.meta.url).resolve("npm/package.json")),
      join(root, "runtime", "lib", "node_modules", "npm"),
    );
    const npm = join(root, "tools", "npm");
    await script(npm, "#!/bin/sh\necho tools-npm\n");
    const env = { HOME: root, PATH: `${dirname(npm)}:/usr/bin:/bin` };
    const launch = new HostToolchain(env, runtime).command("npm", ["-v"], {
      env,
    });
    expect(launch).toMatchObject({ command: npm, args: ["-v"] });
  });

  it("preserves binary output from buffered launches", async () => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
    const result = await execHostFileBuffer(process.execPath, [
      "-e",
      `process.stdout.write(Buffer.from(${JSON.stringify([...bytes])}))`,
    ]);
    expect(result.stdout.equals(bytes)).toBe(true);
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
    await script(
      join(bin, "tool.cmd"),
      `@"${process.execPath}" "%~dp0print.js" %*\r\n`,
    );
    await writeFile(
      join(bin, "print.js"),
      "process.stdout.write(process.argv[2]);",
    );
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
