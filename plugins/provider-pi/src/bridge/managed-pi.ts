import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { experimental_hostToolchain as hostToolchain } from "@get-bb/plugin-sdk/process";
import {
  type ProviderInstallationCommand,
  experimental_formatCommand as formatCommand,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";

const manifestSchema = z.object({ bin: z.object({ pi: z.string().min(1) }) });

export function managedPiDirectory(): string {
  return path.join(homedir(), ".bb", "provider-clis", "pi");
}

export function managedPiExecutable(): string {
  return path.join(
    managedPiDirectory(),
    process.platform === "win32" ? "pi.cmd" : "pi",
  );
}

export function managedPiEntry(): string | null {
  try {
    const root = realpathSync(
      path.join(
        managedPiDirectory(),
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
      ),
    );
    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")),
    );
    const entry = realpathSync(path.resolve(root, manifest.bin.pi));
    const relative = path.relative(root, entry);
    return relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative) &&
      existsSync(managedPiExecutable())
      ? entry
      : null;
  } catch {
    return null;
  }
}

async function installPi(
  npm: string,
  prefix: string,
  packageName: string,
  executable: string,
  runtime: string,
  electron: boolean,
  appImage: boolean,
): Promise<void> {
  const { spawn } = process.getBuiltinModule("node:child_process");
  const { mkdir, readFile, realpath, writeFile } =
    process.getBuiltinModule("node:fs/promises");
  const path = process.getBuiltinModule("node:path");
  await mkdir(prefix, { recursive: true });
  const child = spawn(
    process.execPath,
    [
      npm,
      "install",
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `${packageName}@latest`,
    ],
    { stdio: "inherit", env: process.env },
  );
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`Pi installation failed (${code})`);
  const root = await realpath(
    path.join(prefix, "node_modules", ...packageName.split("/")),
  );
  const manifest: unknown = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("bin" in manifest) ||
    typeof manifest.bin !== "object" ||
    manifest.bin === null ||
    !("pi" in manifest.bin) ||
    typeof manifest.bin.pi !== "string"
  )
    throw new Error("Pi package has no executable");
  const cli = await realpath(path.resolve(root, manifest.bin.pi));
  const relative = path.relative(root, cli);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("Pi executable is outside its package");
  const [quotedRuntime, quotedCli] = [runtime, cli].map((value) =>
    process.platform === "win32"
      ? `"${value.replaceAll("%", "%%")}"`
      : `'${value.replaceAll("'", "'\\''")}'`,
  );
  const appImageArguments = `--input-type=module --eval 'process.argv.pop(); await import(process.getBuiltinModule("node:url").pathToFileURL(process.argv[1]).href)' -- `;
  const wrapper =
    process.platform === "win32"
      ? `@echo off\r\nsetlocal DisableDelayedExpansion\r\n${electron ? 'set "ELECTRON_RUN_AS_NODE=1"\r\n' : ""}${quotedRuntime} ${quotedCli} %*\r\n`
      : `#!/bin/sh\n${electron ? "export ELECTRON_RUN_AS_NODE=1\n" : ""}exec ${quotedRuntime} ${appImage ? appImageArguments : ""}${quotedCli} "$@"${appImage ? " --no-sandbox" : ""}\n`;
  await writeFile(executable, wrapper, { mode: 0o755 });
}

export function managedPiInstallCommand(
  packageName: string,
): ProviderInstallationCommand {
  const command = hostToolchain.node();
  const runtime =
    process.versions.electron &&
    process.platform === "linux" &&
    process.env.APPIMAGE
      ? process.env.APPIMAGE
      : command;
  const args = [
    "--input-type=module",
    "--eval",
    `await (${installPi.toString()})(...${JSON.stringify([hostToolchain.bundledNpmCli(), managedPiDirectory(), packageName, managedPiExecutable(), runtime, Boolean(process.versions.electron), runtime !== command])})`,
  ];
  return {
    command,
    args,
    displayCommand: formatCommand(command, [
      hostToolchain.bundledNpmCli(),
      "install",
      "--prefix",
      managedPiDirectory(),
      "--ignore-scripts",
      `${packageName}@latest`,
    ]),
  };
}

export function managedPiEnvironment(
  env: NodeJS.ProcessEnv,
  command: string,
): NodeJS.ProcessEnv {
  return command === hostToolchain.node() && process.versions.electron
    ? { ...env, ELECTRON_RUN_AS_NODE: "1" }
    : env;
}

export function managedPiLoginCommand(): string | null {
  if (managedPiEntry() === null) return null;
  const executable = managedPiExecutable();
  return process.platform === "win32"
    ? `& '${executable.replaceAll("'", "''")}'`
    : formatCommand(executable, []);
}
