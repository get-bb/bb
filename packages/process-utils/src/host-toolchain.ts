import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
} from "node:path";
import { fileURLToPath } from "node:url";
import { whichCommandSync } from "which-command";

const NETWORK_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];
const SHELL_START = "__BB_SHELL_ENV_START__";
const SHELL_END = "__BB_SHELL_ENV_END__";
const PROBE_TIMEOUT_MS = 3000;
const PROBE_OUTPUT_MAX_CHARS = 1024 * 1024;

export interface HostCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

interface HostCommandOptions {
  cwd?: string | URL;
  env?: NodeJS.ProcessEnv;
}

function executable(file: string): boolean {
  try {
    accessSync(
      file,
      process.platform === "win32" ? constants.F_OK : constants.X_OK,
    );
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (process.platform !== "win32") return env[key];
  return env[
    Object.keys(env).find(
      (entry) => entry.toUpperCase() === key.toUpperCase(),
    ) ?? key
  ];
}

function mergePath(...paths: (string | undefined)[]): string {
  const seen = new Set<string>();
  return paths
    .flatMap((value) => (value ?? "").split(delimiter))
    .filter((entry) => {
      if (!entry) return false;
      const key =
        process.platform === "win32"
          ? entry.replace(/[\\/]+$/u, "").toLowerCase()
          : entry;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(delimiter);
}

function runProbe(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        env,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      finish(null);
      return;
    }
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, PROBE_TIMEOUT_MS);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < PROBE_OUTPUT_MAX_CHARS) stdout += chunk;
    });
    child.once("error", () => finish(null));
    child.once("close", (code) => finish(code));
  });
}

async function readShellEnvironment(
  env: NodeJS.ProcessEnv,
  retainPrevious: boolean,
): Promise<NodeJS.ProcessEnv | null> {
  if (process.platform === "win32") {
    const registry = join(
      envValue(env, "SystemRoot") ?? "C:\\Windows",
      "System32",
      "reg.exe",
    );
    const values: NodeJS.ProcessEnv = { ...env };
    const paths: string[] = [];
    for (const key of [
      "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
      "HKCU\\Environment",
    ]) {
      const result = await runProbe(registry, ["query", key], env);
      if (result.status !== 0) continue;
      for (const match of result.stdout.matchAll(
        /^ {4}(.+?) {4}REG_[A-Z_]+ {4}(.*)$/gmu,
      )) {
        const name = match[1]?.trim();
        if (!name) continue;
        const value = (match[2] ?? "").trim();
        if (name.toUpperCase() === "PATH") paths.push(value);
        else {
          const existing = Object.keys(values).find(
            (key) => key.toUpperCase() === name.toUpperCase(),
          );
          values[existing ?? name] = value;
        }
      }
    }
    const expand = (value: string): string => {
      for (let depth = 0; depth < 10; depth += 1) {
        const expanded = value.replace(
          /%([^%;\\/]+)%/gu,
          (reference, variable: string) =>
            envValue(values, variable) ?? reference,
        );
        if (expanded === value) break;
        value = expanded;
      }
      return value;
    };
    return paths.length === 0
      ? null
      : { PATH: mergePath(...paths.map(expand), envValue(env, "PATH")) };
  }
  const shell =
    env.SHELL?.trim() ||
    (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  const command = `printf '%s\\n' ${SHELL_START}; /usr/bin/env; printf '%s\\n' ${SHELL_END}`;
  const shellArgs = ["sh", "dash"].includes(basename(shell))
    ? ["-lc"]
    : ["-ilc", "-lc"];
  for (const arg of shellArgs) {
    const result = await runProbe(shell, [arg, command], env);
    if (result.status !== 0) {
      if (retainPrevious) return null;
      continue;
    }
    const start = result.stdout.indexOf(`${SHELL_START}\n`);
    const end = result.stdout.indexOf(`\n${SHELL_END}`, start);
    if (start < 0 || end < 0) {
      if (retainPrevious) return null;
      continue;
    }
    const values: NodeJS.ProcessEnv = {};
    for (const line of result.stdout
      .slice(start + SHELL_START.length + 1, end)
      .split("\n")) {
      const separator = line.indexOf("=");
      const key = line.slice(0, separator);
      if (key === "PATH" || NETWORK_KEYS.includes(key))
        values[key] = line.slice(separator + 1);
    }
    if (values.PATH) return values;
  }
  return null;
}

export class HostToolchain {
  private shellEnv: NodeJS.ProcessEnv = {};
  private readonly inheritedPath: string | undefined;
  private readonly generatedPaths = new Set<string>();
  private readonly misses = new Set<string>();
  private nodePath: string;
  private refreshing: Promise<void> | null = null;
  private refreshedAt = 0;

  constructor(
    private readonly baseEnv: NodeJS.ProcessEnv = process.env,
    private readonly runtimePath: string = process.execPath,
  ) {
    this.inheritedPath = envValue(baseEnv, "PATH");
    this.nodePath = runtimePath;
  }

  refresh(): Promise<void> {
    if (this.refreshing !== null) return this.refreshing;
    this.misses.clear();
    this.refreshedAt = Date.now();
    const retainPrevious = this.shellEnv.PATH !== undefined;
    this.refreshing = readShellEnvironment(this.baseEnv, retainPrevious)
      .then((env) => {
        if (env !== null) this.shellEnv = env;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  invalidateFailure(errorOrCode: unknown): void {
    const code =
      typeof errorOrCode === "object" &&
      errorOrCode !== null &&
      "code" in errorOrCode
        ? errorOrCode.code
        : errorOrCode;
    if (code === "ENOENT" || code === 127) void this.refresh();
  }

  private managesPath(path: string | undefined): boolean {
    return (
      path === undefined ||
      path === this.inheritedPath ||
      this.generatedPaths.has(path)
    );
  }

  private searchPath(env: NodeJS.ProcessEnv): string {
    const inherited = envValue(env, "PATH");
    const home =
      envValue(env, process.platform === "win32" ? "USERPROFILE" : "HOME") ??
      homedir();
    const fallbacks = [
      join(home, ".local", "bin"),
      join(home, ".local", "share", "mise", "shims"),
      join(home, ".asdf", "shims"),
      join(home, ".asdf", "bin"),
      join(home, ".volta", "bin"),
    ];
    if (process.platform !== "win32")
      fallbacks.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin");
    return mergePath(
      this.managesPath(inherited) ? this.shellEnv.PATH : undefined,
      inherited,
      executable(this.nodePath) ? dirname(this.nodePath) : undefined,
      ...fallbacks,
    );
  }

  environment(env: NodeJS.ProcessEnv = this.baseEnv): NodeJS.ProcessEnv {
    const inherited = envValue(env, "PATH");
    let path = inherited;
    if (this.managesPath(inherited)) {
      path = this.searchPath(env);
      this.generatedPaths.add(path);
    }
    const result: NodeJS.ProcessEnv = { ...env };
    if (process.platform === "win32") {
      for (const key of Object.keys(result))
        if (key !== "PATH" && key.toUpperCase() === "PATH") delete result[key];
    }
    if (path !== undefined) result.PATH = path;
    for (const key of NETWORK_KEYS)
      if (result[key] === undefined && this.shellEnv[key] !== undefined)
        result[key] = this.shellEnv[key];
    return result;
  }

  private lookup(command: string, options: HostCommandOptions): string | null {
    const env = this.environment(options.env);
    const cwd =
      options.cwd instanceof URL
        ? fileURLToPath(options.cwd)
        : (options.cwd ?? process.cwd());
    if (command === "bb") {
      for (const candidate of [
        env.BB_CLI_LAUNCHER,
        env.BB_CLI,
        env.BB_CLI_DIR ? join(env.BB_CLI_DIR, "bb") : undefined,
      ]) {
        if (
          candidate?.trim() &&
          isAbsolute(candidate.trim()) &&
          executable(candidate.trim())
        )
          return candidate.trim();
      }
    }
    const extension = extname(command);
    const pathExt = envValue(env, "PATHEXT");
    const path = this.searchPath(options.env ?? this.baseEnv);
    const lookupOptions = {
      cwd,
      path,
      pathExt: extension
        ? `${extension};${pathExt ?? ".EXE;.COM;.CMD;.BAT"}`
        : pathExt,
    };
    const found =
      command === "bb"
        ? path
            .split(delimiter)
            .filter(isAbsolute)
            .map((directory) =>
              whichCommandSync(join(directory, command), lookupOptions),
            )
            .find(Boolean)
        : whichCommandSync(command, lookupOptions);
    if (found) return found;
    if (command === "claude" && process.platform !== "win32") {
      const home = env.HOME;
      const candidate = home ? join(home, ".claude", "local", "claude") : null;
      if (candidate && executable(candidate)) return candidate;
    }
    return null;
  }

  resolve(command: string, options: HostCommandOptions = {}): string | null {
    const found = this.lookup(command, options);
    if (found !== null) return found;
    const key = `${command}\0${String(options.cwd ?? "")}\0${envValue(options.env ?? this.baseEnv, "PATH") ?? ""}`;
    const sinceRefresh = Date.now() - this.refreshedAt;
    if (
      !(this.misses.has(key) && sinceRefresh < 30_000) &&
      (this.misses.size === 0 || sinceRefresh >= 1_000)
    )
      void this.refresh();
    this.misses.add(key);
    return null;
  }

  node(options: HostCommandOptions = {}): string {
    if (executable(this.nodePath)) return this.nodePath;
    const stableHomebrew = this.runtimePath.replace(
      /\/Cellar\/([^/]+)\/[^/]+\//u,
      "/opt/$1/",
    );
    const candidates = [
      stableHomebrew,
      process.argv0,
      this.lookup(process.platform === "win32" ? "node.exe" : "node", options),
    ];
    for (const candidate of candidates) {
      if (!candidate || !isAbsolute(candidate) || !executable(candidate))
        continue;
      const probe = spawnSync(
        candidate,
        [
          "-p",
          "JSON.stringify({path:process.execPath,abi:process.versions.modules,electron:!!process.versions.electron})",
        ],
        {
          env: this.environment(options.env),
          cwd: options.cwd,
          encoding: "utf8",
          timeout: PROBE_TIMEOUT_MS,
          killSignal: "SIGKILL",
          windowsHide: true,
        },
      );
      if (probe.status !== 0) continue;
      try {
        const runtime: unknown = JSON.parse(probe.stdout.trim());
        if (
          typeof runtime !== "object" ||
          runtime === null ||
          !("path" in runtime) ||
          typeof runtime.path !== "string" ||
          !("abi" in runtime) ||
          runtime.abi !== process.versions.modules ||
          !("electron" in runtime) ||
          runtime.electron !== Boolean(process.versions.electron)
        )
          continue;
        if (isAbsolute(runtime.path) && executable(runtime.path)) {
          this.nodePath = runtime.path;
          return runtime.path;
        }
      } catch {}
    }
    throw Object.assign(
      new Error(
        "The Node runtime was removed and no replacement was found. Reinstall Node or restart bb with an available runtime.",
      ),
      { code: "ENOENT" },
    );
  }

  bundledNpmCli(command: "npm" | "npx" = "npm"): string {
    const require = createRequire(import.meta.url);
    return join(
      dirname(require.resolve("npm/package.json")),
      "bin",
      `${command}-cli.js`,
    );
  }

  npmCli(
    command: "npm" | "npx" = "npm",
    options: HostCommandOptions = {},
  ): { node: string; cli: string } | null {
    const bin = `${command}-cli.js`;
    const runtime = process.versions.electron ? null : this.node(options);
    const candidates: { node: string; cli: string }[] = [];
    if (runtime !== null)
      for (const cli of [
        join(dirname(runtime), "..", "lib", "node_modules", "npm", "bin", bin),
        join(dirname(runtime), "node_modules", "npm", "bin", bin),
      ])
        candidates.push({ node: runtime, cli });
    const installed = this.resolve(command, options);
    if (installed) {
      try {
        const cli = realpathSync(installed);
        const npmRoot = dirname(dirname(cli));
        const node = [
          join(npmRoot, "..", "..", "..", "bin", "node"),
          join(npmRoot, "..", "..", "node.exe"),
          join(dirname(installed), "node"),
        ].find(executable);
        if (basename(cli) === bin && node !== undefined)
          candidates.push({ node: realpathSync(node), cli });
      } catch {}
    }
    if (runtime !== null) {
      try {
        candidates.push({ node: runtime, cli: this.bundledNpmCli(command) });
      } catch {}
    }
    return candidates.find((candidate) => existsSync(candidate.cli)) ?? null;
  }

  command(
    command: string,
    args: readonly string[] = [],
    options: HostCommandOptions = {},
  ): HostCommand {
    let file =
      command === this.runtimePath
        ? this.node(options)
        : (this.resolve(command, options) ?? command);
    const argv = [...args];
    let needsRuntimePath = /(?:^|[\\/])(?:npm|npx)-cli\.js$/u.test(
      args[0] ?? "",
    );
    const name = basename(command)
      .toLowerCase()
      .replace(/\.(cmd|exe|bat)$/u, "");
    if (name === "npm" || name === "npx") {
      const npm = this.npmCli(name, options);
      if (npm) {
        file = npm.node;
        argv.unshift(npm.cli);
        needsRuntimePath = true;
      }
    }
    const env = this.environment(options.env);
    if (needsRuntimePath) {
      env.PATH = mergePath(dirname(file), env.PATH);
      this.generatedPaths.add(env.PATH);
    }
    return { command: file, args: argv, env };
  }
}

const toolchainKey = Symbol.for("@bb/process-utils/host-toolchain");
const shared: typeof globalThis & { [toolchainKey]?: HostToolchain } =
  globalThis;
export const hostToolchain = (shared[toolchainKey] ??= new HostToolchain());
