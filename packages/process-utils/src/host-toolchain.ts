import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  openSync,
  readSync,
  closeSync,
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

export interface HostCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  generation: number;
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

function readShellEnvironment(
  env: NodeJS.ProcessEnv,
  retainPrevious: boolean,
): NodeJS.ProcessEnv | null {
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
      const result = spawnSync(registry, ["query", key], {
        env,
        encoding: "utf8",
        timeout: 3000,
        killSignal: "SIGKILL",
        windowsHide: true,
      });
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
    const result = spawnSync(shell, [arg, command], {
      env,
      encoding: "utf8",
      timeout: 3000,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
  private revision = 0;
  private refreshedAt = 0;
  private invalidated = false;

  constructor(
    private readonly baseEnv: NodeJS.ProcessEnv = process.env,
    private readonly runtimePath: string = process.execPath,
  ) {
    this.inheritedPath = envValue(baseEnv, "PATH");
    this.nodePath = runtimePath;
  }

  get generation(): number {
    return this.revision;
  }

  refresh(): void {
    this.invalidated = false;
    const env = readShellEnvironment(
      this.baseEnv,
      this.shellEnv.PATH !== undefined,
    );
    if (env !== null) this.shellEnv = env;
    this.misses.clear();
    this.revision += 1;
    this.refreshedAt = Date.now();
  }

  invalidateFailure(errorOrCode: unknown): void {
    const code =
      typeof errorOrCode === "object" &&
      errorOrCode !== null &&
      "code" in errorOrCode
        ? errorOrCode.code
        : errorOrCode;
    if (code === "ENOENT" || code === 127) {
      this.invalidated = true;
      this.misses.clear();
    }
  }

  environment(env: NodeJS.ProcessEnv = this.baseEnv): NodeJS.ProcessEnv {
    if (this.invalidated) this.refresh();
    const home =
      envValue(env, process.platform === "win32" ? "USERPROFILE" : "HOME") ??
      homedir();
    const inherited = envValue(env, "PATH");
    const managedPath =
      inherited === this.inheritedPath ||
      (inherited !== undefined && this.generatedPaths.has(inherited));
    const fallbacks = [
      join(home, ".local", "bin"),
      join(home, ".local", "share", "mise", "shims"),
      join(home, ".asdf", "shims"),
      join(home, ".asdf", "bin"),
      join(home, ".volta", "bin"),
    ];
    if (process.platform !== "win32")
      fallbacks.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin");
    const path = mergePath(
      managedPath ? this.shellEnv.PATH : inherited,
      inherited,
      executable(this.nodePath) ? dirname(this.nodePath) : undefined,
      ...fallbacks,
    );
    this.generatedPaths.add(path);
    const result: NodeJS.ProcessEnv = { ...env };
    if (process.platform === "win32") {
      for (const key of Object.keys(result))
        if (key !== "PATH" && key.toUpperCase() === "PATH") delete result[key];
    }
    result.PATH = path;
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
    const lookupOptions = {
      cwd,
      path: env.PATH,
      pathExt: extension
        ? `${extension};${pathExt ?? ".EXE;.COM;.CMD;.BAT"}`
        : pathExt,
    };
    const found =
      command === "bb"
        ? (env.PATH ?? "")
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
    const generation = this.generation;
    const found = this.lookup(command, options);
    if (found !== null) return found;
    const key = `${command}\0${String(options.cwd ?? "")}\0${envValue(options.env ?? this.baseEnv, "PATH") ?? ""}`;
    if (this.misses.has(key) && Date.now() - this.refreshedAt < 30_000)
      return null;
    if (
      generation === this.generation &&
      (this.misses.size === 0 || Date.now() - this.refreshedAt >= 1_000)
    )
      this.refresh();
    this.misses.add(key);
    return this.lookup(command, options);
  }

  node(options: HostCommandOptions = {}): string {
    if (executable(this.nodePath)) return this.nodePath;
    this.refresh();
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
          timeout: 3000,
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
  ): string | null {
    const node = this.node(options);
    const bin = `${command}-cli.js`;
    const candidates = [
      join(dirname(node), "..", "lib", "node_modules", "npm", "bin", bin),
      join(dirname(node), "node_modules", "npm", "bin", bin),
    ];
    const installed = this.resolve(command, options);
    if (installed) {
      try {
        const real = realpathSync(installed);
        if (basename(real) === bin) candidates.push(real);
      } catch {}
    }
    try {
      candidates.push(this.bundledNpmCli(command));
    } catch {}
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
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
    let argv = [...args];
    let needsRuntimePath = /(?:^|[\\/])(?:npm|npx)-cli\.js$/u.test(
      args[0] ?? "",
    );
    const name = basename(command)
      .toLowerCase()
      .replace(/\.(cmd|exe|bat)$/u, "");
    if (name === "npm" || name === "npx") {
      const cli = this.npmCli(name, options);
      if (cli) {
        file = this.node(options);
        argv.unshift(cli);
        needsRuntimePath = true;
      }
    } else {
      try {
        if (!executable(file))
          return {
            command: file,
            args: argv,
            env: this.environment(options.env),
            generation: this.generation,
          };
        const fd = openSync(file, "r");
        const buffer = Buffer.alloc(256);
        let size: number;
        try {
          size = readSync(fd, buffer, 0, buffer.length, 0);
        } finally {
          closeSync(fd);
        }
        const head = buffer.toString("utf8", 0, size).split(/\r?\n/u)[0] ?? "";
        if (/^#!\s*\/usr\/bin\/env\s+node\s*$/u.test(head)) {
          argv.unshift(file);
          needsRuntimePath = true;
          file = this.node(options);
        }
      } catch {}
    }
    const env = this.environment(options.env);
    if (needsRuntimePath) {
      env.PATH = mergePath(dirname(file), env.PATH);
      this.generatedPaths.add(env.PATH);
    }
    return { command: file, args: argv, env, generation: this.generation };
  }
}

const toolchainKey = Symbol.for("@bb/process-utils/host-toolchain");
const shared: typeof globalThis & { [toolchainKey]?: HostToolchain } =
  globalThis;
export const hostToolchain = (shared[toolchainKey] ??= new HostToolchain());
