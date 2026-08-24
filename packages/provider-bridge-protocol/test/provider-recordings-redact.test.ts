import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const REDACT_SCRIPT = new URL(
  "../../../scripts/provider-recordings/redact.mjs",
  import.meta.url,
);

it("redacts every documented GitHub token prefix", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-recording-redact-"));
  const inputDir = join(root, "input");
  const outputDir = join(root, "output");
  const tokens = [
    `ghp_${"a".repeat(36)}`,
    `gho_${"b".repeat(36)}`,
    `ghu_${"c".repeat(36)}`,
    `ghs_${"d".repeat(36)}`,
    `ghs_12345_${"e".repeat(12)}.${"f".repeat(12)}.${"g".repeat(12)}`,
    `ghr_${"h".repeat(36)}`,
    `github_pat_${"i".repeat(82)}`,
  ];

  try {
    mkdirSync(inputDir);
    writeFileSync(
      join(inputDir, "github.ndjson"),
      `${JSON.stringify({ line: JSON.stringify({ tokens }) })}\n`,
    );

    const stdout = execFileSync(
      process.execPath,
      [REDACT_SCRIPT.pathname, inputDir, outputDir, "--home", "/home/tester"],
      { encoding: "utf8" },
    );
    const output = readFileSync(join(outputDir, "github.ndjson"), "utf8");

    expect(stdout).toContain("0 survivors");
    for (const token of tokens) expect(output).not.toContain(token);
    expect(output.match(/REDACTED/g)).toHaveLength(tokens.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
