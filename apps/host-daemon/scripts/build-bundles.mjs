import { chmod, copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bundleTargets } from "./bundle-manifest.mjs";
import {
  createNativeExternalPatterns,
  externalPackagePatterns,
  generateTemplatesIfRequested,
} from "../../../scripts/build-utils.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDir, "..");
const workspaceRoot = resolve(packageRoot, "..", "..");

async function main() {
  await import("../../../packages/plugin-build/scripts/generate-runtime-export-manifest.mjs");
  await generateTemplatesIfRequested(true);

  for (const target of bundleTargets) {
    await mkdir(dirname(target.outfile), { recursive: true });
    await build({
      banner: {
        js: target.banner,
      },
      bundle: true,
      conditions: ["source"],
      entryPoints: [target.entryPoint],
      external: [
        ...createNativeExternalPatterns({
          bundledPackages: target.bundledPackages,
        }),
        ...externalPackagePatterns(target.externalPackages ?? []),
      ],
      format: "esm",
      legalComments: "none",
      minify: true,
      outfile: target.outfile,
      platform: "node",
      sourcemap: false,
      target: "node22",
    });
    if (target.executable) {
      await chmod(target.outfile, 0o755);
    }
    const bundleStats = await stat(target.outfile);
    console.log(`${target.label}: ${bundleStats.size} bytes`);
  }

  const titleCommandPath = resolve(
    workspaceRoot,
    "apps",
    "cli",
    "bin",
    "title",
  );
  const outputTitleCommandPath = resolve(packageRoot, "dist", "title");
  await copyFile(titleCommandPath, outputTitleCommandPath);
  await chmod(outputTitleCommandPath, 0o755);

  const outputBbCmdPath = resolve(packageRoot, "dist", "bb.cmd");
  await writeFile(
    outputBbCmdPath,
    [
      "@echo off",
      "setlocal EnableExtensions",
      'set "SCRIPT_DIR=%~dp0"',
      'set "CLI_ENTRY=%SCRIPT_DIR%bb"',
      "if not exist \"%CLI_ENTRY%\" (",
      "  echo Missing bundled bb CLI entry at %CLI_ENTRY%. 1>&2",
      "  exit /b 1",
      ")",
      "call :find_node",
      "if not defined NODE_EXE (",
      "  echo node.exe not found on PATH. 1>&2",
      "  exit /b 1",
      ")",
      '"%NODE_EXE%" "%CLI_ENTRY%" %*',
      "exit /b %ERRORLEVEL%",
      "",
      ":find_node",
      "setlocal EnableDelayedExpansion",
      'set "NODE_EXE="',
      'for %%D in ("%PATH:;=";"%") do (',
      '  set "ENTRY=%%~D"',
      '  if defined ENTRY if /I not "!ENTRY!"=="." if /I not "!ENTRY:~0,1!"=="." (',
      '    if /I "!ENTRY:~1,1!"==":" (',
      '      if exist "!ENTRY!\\node.exe" (',
      '        endlocal & set "NODE_EXE=%%~D\\node.exe"',
      "        goto :eof",
      "      )",
      '    ) else if /I "!ENTRY:~0,2!"=="\\\\" (',
      '      if exist "!ENTRY!\\node.exe" (',
      '        endlocal & set "NODE_EXE=%%~D\\node.exe"',
      "        goto :eof",
      "      )",
      "    )",
      "  )",
      ")",
      "endlocal",
      "goto :eof",
      "",
    ].join("\r\n"),
    "utf8",
  );
}

void main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
