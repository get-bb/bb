import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { whichCommandSync } from "which-command";
import { z } from "zod";

const piPackageSchema = z.object({
  bin: z.union([z.string().min(1), z.object({ pi: z.string().min(1) })]),
});

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function resolvePiNpmShim(
  executablePath: string,
  nodeExecutable: string,
): { command: string; args: string[] } | null {
  if (path.extname(executablePath).toLowerCase() !== ".cmd") return null;
  const prefix = path.dirname(executablePath);
  const packageRoot =
    path.basename(prefix).toLowerCase() === ".bin" &&
    path.basename(path.dirname(prefix)).toLowerCase() === "node_modules"
      ? path.dirname(prefix)
      : path.join(prefix, "node_modules");
  try {
    const packageDir = realpathSync(
      path.join(packageRoot, "@earendil-works", "pi-coding-agent"),
    );
    const pkg = piPackageSchema.parse(
      JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")),
    );
    const cli = realpathSync(
      path.resolve(packageDir, typeof pkg.bin === "string" ? pkg.bin : pkg.bin.pi),
    );
    const relative = path.relative(packageDir, cli);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      !isFile(cli)
    ) return null;
    const siblingNode = path.join(prefix, "node.exe");
    return { command: isFile(siblingNode) ? siblingNode : nodeExecutable, args: [cli] };
  } catch {
    return null;
  }
}

export function resolveDefaultWindowsPiLaunch(
  env: NodeJS.ProcessEnv,
  cwd: string,
): { command: string; args: string[] } | null {
  if (process.platform !== "win32") return null;
  const keys = Object.keys(env).sort();
  const executable = whichCommandSync("pi", {
    cwd,
    path: env[keys.find((key) => key.toUpperCase() === "PATH") ?? "PATH"],
    pathExt: env[keys.find((key) => key.toUpperCase() === "PATHEXT") ?? "PATHEXT"],
  });
  return executable === undefined ? null : resolvePiNpmShim(executable, process.execPath);
}
