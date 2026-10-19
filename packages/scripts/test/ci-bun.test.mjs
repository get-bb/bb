import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";

it.skipIf(process.platform === "win32").each(["cached", "download", "invalid"])(
  "verifies the Bun archive before extraction: %s",
  (mode) => {
    const root = mkdtempSync(join(tmpdir(), "bb-bun-bootstrap-\\windows-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const platform = process.platform === "darwin" ? "darwin" : "linux";
    const arch = process.arch === "arm64" ? "aarch64" : "x64-baseline";
    const asset = `bun-${platform}-${arch}`;
    const source = join(root, asset);
    mkdirSync(source);
    writeFileSync(join(source, "bun"), "#!/bin/sh\necho 1.3.14\n");
    chmodSync(join(source, "bun"), 0o755);
    execFileSync("zip", ["-qr", "payload.zip", asset], { cwd: root });
    const payload = readFileSync(join(root, "payload.zip"));
    const digest = createHash("sha256").update(payload).digest("hex");
    writeFileSync(join(root, "bun-1.3.14.sha256"), `${digest}  ${asset}.zip\n`);
    writeFileSync(
      join(root, "install.sh"),
      readFileSync(
        fileURLToPath(
          new URL(
            "../../../.github/actions/setup-bun/install.sh",
            import.meta.url,
          ),
        ),
      ),
    );
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "curl"),
      `#!/bin/sh
printf requested > "$RUNNER_TEMP/requested"
while [ "$1" != "--output" ]; do shift; done
shift
${mode === "invalid" ? 'printf corrupt > "$1"' : 'cp "$RUNNER_TEMP/payload.zip" "$1"'}
`,
    );
    chmodSync(join(bin, "curl"), 0o755);
    const install = join(root, "bb-bun-1.3.14");
    mkdirSync(install);
    writeFileSync(
      join(install, "archive.zip"),
      mode === "cached" ? payload : "corrupt cache",
    );
    const result = spawnSync("bash", [join(root, "install.sh")], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: root,
        BUN_VERSION: "1.3.14",
        GITHUB_PATH: join(root, "path"),
      },
    });
    expect(result.status, result.stdout + result.stderr).toBe(
      mode === "invalid" ? 1 : 0,
    );
    expect(existsSync(join(root, "requested"))).toBe(mode !== "cached");
    expect(existsSync(join(install, "archive.zip.download"))).toBe(false);
    if (mode === "invalid") {
      expect(existsSync(join(install, "extracted"))).toBe(false);
      expect(existsSync(join(root, "path"))).toBe(false);
    } else {
      expect(readFileSync(join(root, "path"), "utf8").trim()).toBe(
        join(install, "extracted", asset),
      );
      expect(result.stdout).toContain("Installed Bun 1.3.14.");
    }
  },
);
