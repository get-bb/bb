import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  stat,
  utimes,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ensurePluginArtifacts } from "./ensure-plugin-artifacts.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bb-ensure-plugin-"));
  roots.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "bb-plugin-fixture",
      version: "1.0.0",
      type: "module",
      engines: { bb: ">=0.0" },
      bb: {
        name: "Fixture",
        description: "Build cache fixture",
        branding: { icon: "Zap" },
        server: "./server.ts",
        app: "./app.ts",
        host: "./host.ts",
      },
    }),
  );
  await writeFile(join(root, "server.ts"), "export default { answer: 1 };\n");
  await writeFile(join(root, "app.ts"), "export const answer = 1;\n");
  await writeFile(join(root, "host.ts"), "export default { answer: 1 };\n");
  const toolchain = await resolvePluginBuildToolchain(join(root, "toolchain"));
  return { root, args: { rootDir: root, bbVersion: "0.1.0", toolchain } };
}

it("reuses successful builds across callers and rebuilds content changes even with preserved timestamps", async () => {
  const { root, args } = await fixture();
  expect((await ensurePluginArtifacts(args)).rebuilt).toEqual([
    "server",
    "app",
    "host",
  ]);
  expect((await ensurePluginArtifacts(args)).rebuilt).toEqual([]);
  const source = join(root, "server.ts");
  const previous = await stat(source);
  await writeFile(source, "export default { answer: 2 };\n");
  await utimes(source, previous.atime, previous.mtime);
  expect(
    (await ensurePluginArtifacts({ ...args, targets: ["server"] })).rebuilt,
  ).toEqual(["server"]);
  expect(await readFile(join(root, "dist/server.js"), "utf8")).toContain(
    "answer: 2",
  );
  await rm(join(root, "dist/server.js"));
  expect(
    (await ensurePluginArtifacts({ ...args, targets: ["server"] })).rebuilt,
  ).toEqual(["server"]);
  await writeFile(
    join(root, "node_modules/.cache/bb-plugin-build/server.json"),
    "broken",
  );
  expect(
    (await ensurePluginArtifacts({ ...args, targets: ["server"] })).rebuilt,
  ).toEqual(["server"]);
});

it("serializes overlapping requests and does not mark failed builds current", async () => {
  const { root, args } = await fixture();
  const results = await Promise.all([
    ensurePluginArtifacts({ ...args, targets: ["host"] }),
    ensurePluginArtifacts({ ...args, targets: ["host"] }),
  ]);
  expect(results.flatMap((result) => result.rebuilt)).toEqual(["host"]);
  const output = await readFile(join(root, "dist/host.js"), "utf8");
  await writeFile(join(root, "host.ts"), "export default { broken\n");
  await expect(
    ensurePluginArtifacts({ ...args, targets: ["host"] }),
  ).rejects.toThrow();
  expect(await readFile(join(root, "dist/host.js"), "utf8")).toBe(output);
  await writeFile(join(root, "host.ts"), "export default { fixed: true };\n");
  expect(
    (await ensurePluginArtifacts({ ...args, targets: ["host"] })).rebuilt,
  ).toEqual(["host"]);
});

it("preserves development minification across reload and removes dropped target outputs", async () => {
  const { root, args } = await fixture();
  await ensurePluginArtifacts({ ...args, minify: false });
  expect(
    (await ensurePluginArtifacts({ ...args, targets: ["app", "host"] }))
      .rebuilt,
  ).toEqual([]);
  expect(
    (await ensurePluginArtifacts({ ...args, targets: ["app"], minify: true }))
      .rebuilt,
  ).toEqual(["app"]);
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  delete manifest.bb.host;
  await writeFile(join(root, "package.json"), JSON.stringify(manifest));
  await ensurePluginArtifacts(args);
  await expect(stat(join(root, "dist/host.js"))).rejects.toThrow();
});

it("tracks imported dependency content, linked package replacement, and lockfile changes", async () => {
  const { root, args } = await fixture();
  const dependency = await mkdtemp(join(tmpdir(), "bb-plugin-dependency-"));
  roots.push(dependency);
  await writeFile(
    join(dependency, "package.json"),
    JSON.stringify({
      name: "fixture-dependency",
      version: "1.0.0",
      main: "index.js",
    }),
  );
  await writeFile(join(dependency, "index.js"), "exports.answer = 1;\n");
  await mkdir(join(root, "node_modules"), { recursive: true });
  await symlink(dependency, join(root, "node_modules/fixture-dependency"));
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  manifest.dependencies = { "fixture-dependency": "1.0.0" };
  await writeFile(join(root, "package.json"), JSON.stringify(manifest));
  await writeFile(
    join(root, "server.ts"),
    'export { answer } from "fixture-dependency";\n',
  );
  const request = { ...args, targets: ["server"] as const };
  await ensurePluginArtifacts(request);
  expect((await ensurePluginArtifacts(request)).rebuilt).toEqual([]);
  await writeFile(join(dependency, "index.js"), "exports.answer = 2;\n");
  expect((await ensurePluginArtifacts(request)).rebuilt).toEqual(["server"]);
  const replacement = await mkdtemp(join(tmpdir(), "bb-plugin-replacement-"));
  roots.push(replacement);
  await writeFile(
    join(replacement, "package.json"),
    JSON.stringify({
      name: "fixture-dependency",
      version: "1.0.0",
      main: "index.js",
    }),
  );
  await writeFile(join(replacement, "index.js"), "exports.answer = 3;\n");
  await rm(join(root, "node_modules/fixture-dependency"));
  await symlink(replacement, join(root, "node_modules/fixture-dependency"));
  expect((await ensurePluginArtifacts(request)).rebuilt).toEqual(["server"]);
  await writeFile(join(root, "package-lock.json"), "{}\n");
  expect((await ensurePluginArtifacts(request)).rebuilt).toEqual(["server"]);
  expect(
    (await ensurePluginArtifacts({ ...request, bbVersion: "0.2.0" })).rebuilt,
  ).toEqual(["server"]);
});

it("shares successful builds between separate CLI and server processes", async () => {
  const { args } = await fixture();
  const workerRoot = await mkdtemp(join(tmpdir(), "bb-plugin-build-worker-"));
  roots.push(workerRoot);
  const worker = join(workerRoot, "build.mjs");
  const helper = pathToFileURL(
    join(import.meta.dirname, "ensure-plugin-artifacts.ts"),
  ).href;
  await writeFile(
    worker,
    `import { ensurePluginArtifacts } from ${JSON.stringify(helper)};
console.log(JSON.stringify(await ensurePluginArtifacts(${JSON.stringify({ ...args, targets: ["host"] })})));
`,
  );
  const exec = promisify(execFile);
  const run = () =>
    exec(process.execPath, [
      "--conditions=source",
      "--import",
      createRequire(import.meta.url).resolve("tsx"),
      worker,
    ]);
  const runs = await Promise.all([run(), run()]);
  expect(runs.map(({ stdout }) => JSON.parse(stdout).rebuilt).flat()).toEqual([
    "host",
  ]);
  expect(
    (await ensurePluginArtifacts({ ...args, targets: ["host"] })).rebuilt,
  ).toEqual([]);
}, 30_000);
