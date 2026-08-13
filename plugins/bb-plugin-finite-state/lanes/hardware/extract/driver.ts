import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 120_000;

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
}

export interface DriverResult {
  exitCode: number;
  stderr: string;
}

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
      const result = await execFileAsync(path, ["version"], { encoding: "utf8", timeout: 5_000 });
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
): DriverCommand {
  switch (kind) {
    case "sheet_svg": return { executable: cliPath, args: ["sch", "export", "svg", "--output", outputPath, "--no-background-color", "--exclude-drawing-sheet", sourcePath], minMajor: 7 };
    case "bom": return { executable: cliPath, args: ["sch", "export", "bom", "--output", outputPath, sourcePath], minMajor: 8 };
    case "netlist": return { executable: cliPath, args: ["sch", "export", "netlist", "--output", outputPath, sourcePath], minMajor: 7 };
    case "erc": return { executable: cliPath, args: ["sch", "erc", "--format", "json", "--output", outputPath, sourcePath], minMajor: 8 };
    case "board_svg": return {
      executable: cliPath,
      args: [
        "pcb", "export", "svg", "--output", outputPath,
        "--layers", "F.Cu,B.Cu,F.Silkscreen,B.Silkscreen,Edge.Cuts",
        "--exclude-drawing-sheet", sourcePath,
      ],
      minMajor: 7,
    };
    case "glb": return { executable: cliPath, args: ["pcb", "export", "glb", "--output", outputPath, sourcePath], minMajor: 8 };
    case "gerber": return { executable: cliPath, args: ["pcb", "export", "gerbers", "--output", outputPath, sourcePath], minMajor: 7 };
    case "drill": return { executable: cliPath, args: ["pcb", "export", "drill", "--output", outputPath, sourcePath], minMajor: 7 };
    case "drc": return { executable: cliPath, args: ["pcb", "drc", "--format", "json", "--output", outputPath, sourcePath], minMajor: 8 };
  }
}

export async function executeExtractCommand(
  command: DriverCommand,
  run: (file: string, args: string[]) => Promise<{ exitCode: number; stderr: string }> = async (file, args) => {
    try {
      const result = await execFileAsync(file, args, { encoding: "utf8", timeout: CLI_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
      return { exitCode: 0, stderr: result.stderr };
    } catch (error) {
      const failure = error as Error & { code?: number | string; stderr?: string };
      return { exitCode: typeof failure.code === "number" ? failure.code : -1, stderr: failure.stderr ?? failure.message };
    }
  },
): Promise<DriverResult> {
  return run(command.executable, command.args);
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
