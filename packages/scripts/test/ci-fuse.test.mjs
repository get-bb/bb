import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";

it
  .skipIf(process.platform === "win32")
  .each(["index", "install", "both", "installed"])(
  "installs FUSE with isolated indexes and bounded mirror fallback: %s",
  (failure) => {
    const dir = mkdtempSync(join(tmpdir(), "ci-fuse-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const command = (name, content) =>
      writeFileSync(join(dir, name), content, { mode: 0o755 });
    command("sudo", '#!/bin/sh\nexec "$@"\n');
    command("dpkg", "#!/bin/sh\necho amd64\n");
    command("lsb_release", "#!/bin/sh\necho noble\n");
    command(
      "dpkg-query",
      failure === "installed"
        ? "#!/bin/sh\necho 'install ok installed'\n"
        : "#!/bin/sh\nexit 1\n",
    );
    const log = join(dir, "apt.jsonl");
    writeFileSync(log, "");
    command(
      "apt-get",
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const source = fs.readFileSync(args.find(arg => arg.startsWith('Dir::Etc::sourcelist=')).split('=')[1], 'utf8');
const update = args.includes('update');
fs.appendFileSync(process.env.APT_LOG, JSON.stringify({ source, args, update }) + '\\n');
const primary = source.includes('archive.ubuntu.com');
const failure = process.env.APT_FAILURE;
if (failure === 'both' || (primary && (failure === 'index' ? update : !update))) process.exit(100);
`,
    );
    const result = spawnSync(
      "bash",
      [
        fileURLToPath(
          new URL(
            "../../../.github/actions/install-appimage-fuse/install.sh",
            import.meta.url,
          ),
        ),
      ],
      {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          APT_LOG: log,
          APT_FAILURE: failure,
          FUSE_PACKAGE: "libfuse2t64",
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.status, result.stderr).toBe(failure === "both" ? 1 : 0);
    const calls = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    if (failure === "installed") {
      expect(calls).toEqual([]);
      return;
    }
    const installs = calls.filter((call) => !call.update);
    expect(installs).toHaveLength(
      failure === "index" ? 1 : failure === "install" ? 2 : 0,
    );
    for (const call of calls) {
      expect(call.args).toContain("APT::Update::Error-Mode=any");
      expect(call.args).toContain("Dir::Etc::sourceparts=-");
      expect(call.source).toContain("noble-security main universe");
    }
    expect(calls.at(-1).source).toContain(
      "https://mirrors.edge.kernel.org/ubuntu",
    );
    if (failure !== "both")
      expect(installs.at(-1).args).toContain("libfuse2t64");
  },
);
