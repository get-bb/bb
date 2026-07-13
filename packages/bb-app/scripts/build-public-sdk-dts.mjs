import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const packagesRoot = path.resolve(packageRoot, "..");

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

const inlineWorkspace = {
  name: "inline-bb-workspace",
  resolveId(id) {
    return resolveWorkspaceSource(id);
  },
};

const build = await rollup({
  input: path.join(packageRoot, "src/public-sdk.ts"),
  external: [/^zod($|\/)/u],
  plugins: [
    inlineWorkspace,
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
await build.write({
  file: path.join(packageRoot, "dist/index.d.ts"),
  format: "es",
});
await build.close();
