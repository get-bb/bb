import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);

it.skipIf(process.platform === "win32").each([
  { layout: "Unix", npmDirectory: "lib/node_modules", wrapperFails: true },
  {
    layout: "Windows-style",
    npmDirectory: "bin/node_modules",
    wrapperFails: true,
  },
  { layout: "PATH fallback", npmDirectory: null, wrapperFails: false },
])(
  "accepts a successful npm install with $layout resolution",
  async ({ npmDirectory, wrapperFails }) => {
    const root = await mkdtemp(join(tmpdir(), "bb-npm-wrapper-test-"));
    try {
      const nodeBin = join(root, "runtime", "bin");
      const packageDir = join(root, "package");
      const prefix = join(root, "prefix");
      await Promise.all(
        [nodeBin, packageDir].map((directory) =>
          mkdir(directory, { recursive: true }),
        ),
      );
      const node = join(nodeBin, "node");
      await copyFile(process.execPath, node, constants.COPYFILE_FICLONE);
      await chmod(node, 0o755);
      const standardNpmRoot = resolve(
        dirname(process.execPath),
        "../lib/node_modules/npm",
      );
      const npmCli = await realpath(
        join(standardNpmRoot, "bin", "npm-cli.js"),
      ).catch(() => realpath(join(dirname(process.execPath), "npm")));
      if (npmDirectory !== null) {
        const npmModules = join(root, "runtime", npmDirectory);
        await mkdir(npmModules, { recursive: true });
        await symlink(dirname(dirname(npmCli)), join(npmModules, "npm"));
      }
      const wrapper = join(nodeBin, "npm");
      await writeFile(
        wrapper,
        [
          "#!/bin/sh",
          "set -eu",
          '"$(dirname "$0")/node" "$BB_TEST_NPM_CLI" "$@"',
          ...(wrapperFails ? ["bb-test-missing-reshim-helper"] : []),
          "",
        ].join("\n"),
      );
      await chmod(wrapper, 0o755);
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "bb-self-update-fixture", version: "1.0.0" }),
      );
      const env = {
        HOME: root,
        PATH: "/usr/bin:/bin",
        BB_APP_NPM_PREFIX: prefix,
        BB_TEST_NPM_CLI: npmCli,
        npm_config_cache: join(root, "cache"),
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_update_notifier: "false",
      };
      await execFileAsync(
        process.execPath,
        [npmCli, "pack", "--pack-destination", root, packageDir],
        { env },
      );
      const installerUrl = pathToFileURL(
        fileURLToPath(new URL("./protocol-self-update.ts", import.meta.url)),
      ).href;
      const entry = join(root, "run-update.mjs");
      await writeFile(
        entry,
        `import { readFile } from "node:fs/promises";
import { createProtocolSelfUpdater } from ${JSON.stringify(installerUrl)};
const tarball = await readFile(process.argv[2]);
let failure = null;
const updater = createProtocolSelfUpdater({
  dataDir: process.env.HOME,
  enabled: true,
  serverUrl: "https://update.example.test",
  logger: {
    debug() {}, info() {}, warn() {},
    error(fields) {
      if (fields.err) failure = { code: fields.err.code, stderr: fields.err.stderr };
    },
  },
  fetchFn: async (url) => String(url).endsWith("/install/version")
    ? Response.json({ version: "1.0.0", protocolVersion: 1000000 })
    : new Response(tarball),
});
console.log(JSON.stringify({ result: await updater.handleProtocolMismatch(), failure }));
`,
      );
      const { stdout } = await execFileAsync(
        node,
        [
          "--conditions=source",
          "--import",
          createRequire(import.meta.url).resolve("tsx"),
          entry,
          join(root, "bb-self-update-fixture-1.0.0.tgz"),
        ],
        { env },
      );
      const installed: unknown = JSON.parse(
        await readFile(
          join(prefix, "lib/node_modules/bb-self-update-fixture/package.json"),
          "utf8",
        ),
      );
      expect(installed).toMatchObject({ version: "1.0.0" });
      expect(JSON.parse(stdout), stdout).toEqual({
        result: "updated",
        failure: null,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
