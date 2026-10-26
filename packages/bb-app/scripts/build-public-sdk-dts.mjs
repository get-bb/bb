import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const packagesRoot = path.resolve(packageRoot, "..");
const entryPoint = path.join(packageRoot, "src/public-sdk.ts");
const execFileAsync = promisify(execFile);

async function emitNativeDeclarations(directory) {
  const outDir = path.join(directory, "declarations");
  const configPath = path.join(directory, "tsconfig.json");
  const config = {
    extends: path.join(packageRoot, "tsconfig.json"),
    compilerOptions: {
      declaration: true,
      emitDeclarationOnly: true,
      noEmit: false,
      noEmitOnError: true,
      declarationMap: false,
      sourceMap: false,
      composite: false,
      checkJs: false,
      skipLibCheck: true,
      preserveSymlinks: true,
      target: "ESNext",
      resolveJsonModule: true,
      rootDir: packagesRoot,
      outDir,
      typeRoots: [path.join(packageRoot, "node_modules/@types")],
      paths: {
        "@bb/hono-typed-routes": [
          path.join(packagesRoot, "hono-typed-routes/src/index.ts"),
        ],
      },
    },
    include: [],
    files: [entryPoint],
  };
  const compiler = fileURLToPath(
    new URL("./bin/tsrs", import.meta.resolve("tsrs/package.json")),
  );
  await writeFile(configPath, JSON.stringify(config));
  const { stdout } = await execFileAsync(process.execPath, [
    compiler,
    "-p",
    configPath,
    "--listFilesOnly",
  ]);
  config.files = [
    ...new Set(
      stdout
        .split(/\r?\n/u)
        .filter((file) => path.isAbsolute(file))
        .map((file) => realpathSync(file))
        .filter(
          (file) =>
            file.startsWith(packagesRoot + path.sep) &&
            !file.includes(`${path.sep}node_modules${path.sep}`) &&
            /\.[cm]?tsx?$/u.test(file) &&
            !/\.d\.[cm]?ts$/u.test(file),
        ),
    ),
  ];
  await writeFile(configPath, JSON.stringify(config));
  await execFileAsync(process.execPath, [compiler, "-p", configPath]);
  await Promise.all(
    (await readdir(outDir)).map((name) =>
      symlink(
        path.join(packagesRoot, name, "node_modules"),
        path.join(outDir, name, "node_modules"),
        "dir",
      ),
    ),
  );
  return outDir;
}

function declarationPath(source, directory) {
  if (directory === null || /\.d\.[cm]?ts$/u.test(source)) return source;
  return path
    .join(directory, path.relative(packagesRoot, source))
    .replace(/\.([cm]?ts|tsx)$/u, ".d.$1")
    .replace(/\.d\.tsx$/u, ".d.ts");
}

function resolveWorkspaceSource(id) {
  const match = /^@bb\/([^/]+)(\/.*)?$/u.exec(id);
  if (!match) return null;
  const packageDirectory = path.join(packagesRoot, match[1]);
  const manifestPath = path.join(packageDirectory, "package.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const key = match[2] ? `.${match[2]}` : ".";
  const entry = manifest.exports?.[key];
  const source =
    typeof entry === "string"
      ? entry
      : (entry?.source ?? entry?.types ?? entry?.default);
  return source ? path.join(packageDirectory, source) : null;
}

const supportsNativeCompiler =
  (process.platform === "darwin" && process.arch === "arm64") ||
  (process.platform === "linux" &&
    (process.arch === "arm64" || process.arch === "x64"));
const tempRoot = supportsNativeCompiler
  ? await mkdtemp(path.join(tmpdir(), "bb-public-sdk-dts-"))
  : null;
try {
  const declarationRoot =
    tempRoot === null ? null : await emitNativeDeclarations(tempRoot);
  const build = await rollup({
    input: declarationPath(entryPoint, declarationRoot),
    external: [/^zod($|\/)/u],
    plugins: [
      {
        name: "inline-bb-workspace",
        resolveId(id) {
          const source = resolveWorkspaceSource(id);
          return source === null
            ? null
            : declarationPath(source, declarationRoot);
        },
      },
      dts({
        respectExternal: false,
        compilerOptions: {
          baseUrl: packagesRoot,
          paths: {
            "@bb/hono-typed-routes": ["hono-typed-routes/src/index.ts"],
          },
        },
      }),
    ],
    onwarn(warning) {
      if (warning.code !== "CIRCULAR_DEPENDENCY") {
        console.warn(
          `[build-public-sdk-dts] ${warning.code}: ${warning.message}`,
        );
      }
    },
  });
  try {
    await build.write({
      file: path.join(packageRoot, "dist/index.d.ts"),
      format: "es",
    });
  } finally {
    await build.close();
  }
} finally {
  if (tempRoot !== null) await rm(tempRoot, { recursive: true, force: true });
}
