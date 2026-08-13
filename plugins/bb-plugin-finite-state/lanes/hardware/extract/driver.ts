import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join } from "node:path";

const CLI_TIMEOUT_MS = 120_000;
const CLI_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const CLI_KILL_GRACE_MS = 1_000;

export interface KicadCapability {
  installed: boolean;
  cliPath: string | null;
  version: string | null;
  supported: boolean;
}

export type HwArtifactKind =
  | "sheet_svg" | "board_svg" | "glb" | "bom" | "netlist"
  | "gerber" | "drill" | "drc" | "erc";

export interface DriverCommand {
  executable: string;
  args: string[];
  minMajor: number;
  cwd: string;
}

export type DriverFailureCode =
  | "KICAD_EXIT_NONZERO"
  | "KICAD_CLI_TIMEOUT"
  | "KICAD_CLI_OUTPUT_LIMIT"
  | "KICAD_CLI_SPAWN_FAILED";

export interface DriverResult {
  exitCode: number;
  stderr: string;
  code?: DriverFailureCode;
}

export type DriverRunner = (command: DriverCommand) => Promise<DriverResult>;

export function parseKicadVersion(output: string): string | null {
  return /(?:^|\s)(\d+\.\d+(?:\.\d+)?)(?=\s|-|$)/u.exec(output.trim())?.[1] ?? null;
}

async function executableOnPath(name: string): Promise<string | null> {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue;
    const candidate = join(directory, name);
    try {
      const canonical = await realpath(candidate);
      if (!(await stat(canonical)).isFile()) continue;
      await access(canonical, constants.X_OK);
      return canonical;
    } catch { /* continue */ }
  }
  return null;
}

export async function detectKicadCli(
  options: { find?: () => Promise<string | null>; run?: (path: string) => Promise<string> } = {},
): Promise<KicadCapability> {
  const cliPath = await (options.find ?? (() => executableOnPath("kicad-cli")))();
  if (!cliPath) return { installed: false, cliPath: null, version: null, supported: false };
  try {
    const output = await (options.run ?? (async (path) => {
      const result = await runProcess({
        executable: path,
        args: ["version"],
        cwd: dirname(path),
        minMajor: 7,
      }, 5_000, 1024 * 1024);
      if (result.exitCode !== 0) throw new Error(result.stderr);
      return `${result.stdout}\n${result.stderr}`;
    }))(cliPath);
    const version = parseKicadVersion(output);
    return { installed: true, cliPath, version, supported: version !== null && Number(version.split(".")[0]) >= 7 };
  } catch {
    return { installed: true, cliPath, version: null, supported: false };
  }
}

export function buildExtractCommand(
  cliPath: string,
  kind: HwArtifactKind,
  sourcePath: string,
  outputPath: string,
  cwd = dirname(sourcePath),
): DriverCommand {
  switch (kind) {
    case "sheet_svg": return { executable: cliPath, args: ["sch", "export", "svg", "--output", outputPath, "--no-background-color", "--exclude-drawing-sheet", sourcePath], minMajor: 7, cwd };
    case "bom": return { executable: cliPath, args: ["sch", "export", "bom", "--output", outputPath, sourcePath], minMajor: 8, cwd };
    case "netlist": return { executable: cliPath, args: ["sch", "export", "netlist", "--output", outputPath, sourcePath], minMajor: 7, cwd };
    case "erc": return { executable: cliPath, args: ["sch", "erc", "--format", "json", "--output", outputPath, sourcePath], minMajor: 8, cwd };
    case "board_svg": return {
      executable: cliPath,
      args: [
        "pcb", "export", "svg", "--output", outputPath,
        "--layers", "F.Cu,B.Cu,F.Silkscreen,B.Silkscreen,Edge.Cuts",
        "--exclude-drawing-sheet", sourcePath,
      ],
      minMajor: 7,
      cwd,
    };
    case "glb": return { executable: cliPath, args: ["pcb", "export", "glb", "--output", outputPath, sourcePath], minMajor: 8, cwd };
    case "gerber": return { executable: cliPath, args: ["pcb", "export", "gerbers", "--output", outputPath, sourcePath], minMajor: 7, cwd };
    case "drill": return { executable: cliPath, args: ["pcb", "export", "drill", "--output", outputPath, sourcePath], minMajor: 7, cwd };
    case "drc": return { executable: cliPath, args: ["pcb", "drc", "--format", "json", "--output", outputPath, sourcePath], minMajor: 8, cwd };
  }
}

function narrowedEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"] as const;
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]])) as NodeJS.ProcessEnv;
}

interface ProcessResult extends DriverResult { stdout: string }

function runProcess(
  command: DriverCommand,
  timeoutMs: number,
  maxBuffer: number,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;
    const child = execFile(command.executable, command.args, {
      cwd: command.cwd,
      env: narrowedEnvironment(),
      encoding: "utf8",
      maxBuffer,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (!error) return resolve({ exitCode: 0, stdout, stderr });
      const failure = error as Error & { code?: number | string; killed?: boolean; signal?: string };
      if (timedOut) {
        return resolve({ exitCode: -1, stdout, stderr: `KICAD_CLI_TIMEOUT: process exceeded ${timeoutMs}ms`, code: "KICAD_CLI_TIMEOUT" });
      }
      if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        return resolve({ exitCode: -1, stdout, stderr: `KICAD_CLI_OUTPUT_LIMIT: process output exceeded ${maxBuffer} bytes`, code: "KICAD_CLI_OUTPUT_LIMIT" });
      }
      if (typeof failure.code === "number") {
        return resolve({ exitCode: failure.code, stdout, stderr, code: "KICAD_EXIT_NONZERO" });
      }
      return resolve({ exitCode: -1, stdout, stderr: `KICAD_CLI_SPAWN_FAILED: ${failure.message}`, code: "KICAD_CLI_SPAWN_FAILED" });
    });
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), CLI_KILL_GRACE_MS);
    }, timeoutMs);
  });
}

export async function runKicadProcess(
  command: DriverCommand,
  options: { timeoutMs?: number; maxBuffer?: number } = {},
): Promise<DriverResult> {
  const { stdout: _stdout, ...result } = await runProcess(
    command,
    options.timeoutMs ?? CLI_TIMEOUT_MS,
    options.maxBuffer ?? CLI_MAX_BUFFER_BYTES,
  );
  return result;
}

export async function executeExtractCommand(
  command: DriverCommand,
  run: DriverRunner = runKicadProcess,
): Promise<DriverResult> {
  return run(command);
}

export const sheetSvgCommand = (cli: string, source: string, output: string) => buildExtractCommand(cli, "sheet_svg", source, output);
export const bomCommand = (cli: string, source: string, output: string) => buildExtractCommand(cli, "bom", source, output);
export const netlistCommand = (cli: string, source: string, output: string) => buildExtractCommand(cli, "netlist", source, output);
export const ercCommand = (cli: string, source: string, output: string) => buildExtractCommand(cli, "erc", source, output);
export const boardSvgCommand = (cli: string, source: string, output: string) => buildExtractCommand(cli, "board_svg", source, output);
export const glbCommand = (cli: string, source: string, output: string) => buildExtractCommand(cli, "glb", source, output);
export const gerberCommand = (cli: string, source: string, output: string) => buildExtractCommand(cli, "gerber", source, output);
export const drillCommand = (cli: string, source: string, output: string) => buildExtractCommand(cli, "drill", source, output);
export const drcCommand = (cli: string, source: string, output: string) => buildExtractCommand(cli, "drc", source, output);
