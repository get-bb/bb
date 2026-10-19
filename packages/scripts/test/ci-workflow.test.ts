import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import { isMap, isSeq, parseDocument } from "yaml";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..", "..", "..");

it("limits concurrent Turbo test tasks to the CI runner CPU count", () => {
  const workflow = readFileSync(
    resolve(repoRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  );
  const steps = parseDocument(workflow).getIn(["jobs", "tests", "steps"]);
  const testStep = isSeq(steps)
    ? steps.items.find((step) => isMap(step) && step.get("name") === "Test")
    : undefined;
  if (!isMap(testStep)) throw new Error("Linux test step is missing");

  expect(testStep.get("run")).toContain("--concurrency=4");
});

it("rejects a pnpm version that disagrees with the root manifest", ({
  skip,
}) => {
  skip(
    process.platform === "win32",
    "install-pnpm.sh runs only on Linux and macOS CI runners",
  );
  const fixture = mkdtempSync(join(tmpdir(), "bb-pnpm-version-"));
  onTestFinished(() => rmSync(fixture, { force: true, recursive: true }));
  const fakeBin = resolve(fixture, "bin");
  mkdirSync(fakeBin);
  writeFileSync(
    resolve(fixture, "package.json"),
    '{"packageManager":"pnpm@9.15.1"}\n',
  );
  writeFileSync(resolve(fakeBin, "curl"), "#!/bin/sh\nexit 23\n");
  chmodSync(resolve(fakeBin, "curl"), 0o755);

  const result = spawnSync(
    "bash",
    [resolve(repoRoot, ".github/actions/setup-workspace/install-pnpm.sh")],
    {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_WORKSPACE: fixture,
        PATH: `${fakeBin}:${process.env.PATH}`,
        PNPM_VERSION: "9.15.0",
      },
    },
  );

  expect(result.status).toBe(1);
  expect(result.stdout).toContain(
    "pnpm version mismatch: package.json declares 9.15.1, but the action requested 9.15.0",
  );
});

it.each([
  ["verified cache", true, false, 0],
  ["cold cache", false, false, 0],
  ["corrupt cache", false, true, 0],
  ["invalid download", false, true, 1],
  ["interrupted download", false, false, 28],
] as const)(
  "installs pnpm safely with %s",
  (scenario, cached, corrupt, exitCode) => {
    if (process.platform === "win32") return;
    const dir = mkdtempSync(join(tmpdir(), "bb-pnpm-cache-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const bin = join(dir, "bin");
    const install = join(dir, "pnpm-9.15.0", "bin");
    mkdirSync(bin);
    mkdirSync(install, { recursive: true });
    const payload = "#!/bin/sh\necho 9.15.0\n";
    const digest = createHash("sha256").update(payload).digest("hex");
    writeFileSync(join(dir, "payload"), payload);
    writeFileSync(
      join(dir, "package.json"),
      '{"packageManager":"pnpm@9.15.0"}',
    );
    writeFileSync(
      join(dir, "install-pnpm.sh"),
      readFileSync(
        resolve(repoRoot, ".github/actions/setup-workspace/install-pnpm.sh"),
      ),
    );
    writeFileSync(
      join(dir, "pnpm-9.15.0.sha256"),
      ["linux-x64", "linux-arm64", "macos-x64", "macos-arm64"]
        .map((asset) => `${digest}  pnpm-${asset}`)
        .join("\n"),
    );
    if (cached || corrupt)
      writeFileSync(join(install, "pnpm"), cached ? payload : "corrupt");
    writeFileSync(
      join(bin, "curl"),
      `#!/bin/sh
printf requested > "$GITHUB_WORKSPACE/requested"
while [ "$1" != "--output" ]; do shift; done
shift
${scenario === "invalid download" ? 'printf invalid > "$1"' : 'cp "$GITHUB_WORKSPACE/payload" "$1"'}
exit ${scenario === "interrupted download" ? 28 : 0}
`,
    );
    chmodSync(join(bin, "curl"), 0o755);
    const result = spawnSync("bash", [join(dir, "install-pnpm.sh")], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PNPM_VERSION: "9.15.0",
        RUNNER_TEMP: dir,
        GITHUB_WORKSPACE: dir,
        GITHUB_PATH: join(dir, "path"),
        GITHUB_ENV: join(dir, "env"),
      },
    });
    expect(result.status, result.stderr + result.stdout).toBe(exitCode);
    expect(existsSync(join(dir, "requested"))).toBe(!cached);
    expect(existsSync(join(install, "pnpm.download"))).toBe(false);
    if (exitCode === 0) {
      expect(readFileSync(join(install, "pnpm"), "utf8")).toBe(payload);
      expect(readFileSync(join(dir, "path"), "utf8")).toContain(install);
    } else {
      expect(existsSync(join(install, "pnpm"))).toBe(false);
      expect(existsSync(join(dir, "path"))).toBe(false);
    }
  },
);
