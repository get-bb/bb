import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
      [
        fileURLToPath(REDACT_SCRIPT),
        inputDir,
        outputDir,
        "--home",
        "/home/tester",
      ],
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

it("preserves existing recordings when the input directory is empty", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-recording-redact-empty-"));
  const inputDir = join(root, "input");
  const outputDir = join(root, "output");
  const kept = join(outputDir, "kept.ndjson");
  try {
    mkdirSync(inputDir);
    mkdirSync(outputDir);
    writeFileSync(kept, "keep-me\n");

    expect(() =>
      execFileSync(
        process.execPath,
        [
          fileURLToPath(REDACT_SCRIPT),
          inputDir,
          outputDir,
          "--home",
          "/home/tester",
        ],
        { encoding: "utf8" },
      ),
    ).toThrow(/input recordings are empty/);
    expect(readFileSync(kept, "utf8")).toBe("keep-me\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("preserves auth method ids and subagent targets", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-recording-redact-ids-"));
  const inputDir = join(root, "input");
  const outputDir = join(root, "output");
  const token = `sk-${"a".repeat(24)}`;
  const message = {
    authMethods: [{ id: "cached_token", name: "Sign in (cached_token)" }],
    authToken: token,
    update: {
      rawInput: {
        subagent_id: "child-alpha",
        task_id: "child-alpha",
        task_ids: ["child-alpha"],
        delivery: "interject",
        text: "secret note",
      },
    },
  };
  try {
    mkdirSync(inputDir);
    writeFileSync(
      join(inputDir, "ids.ndjson"),
      `${JSON.stringify({ line: JSON.stringify(message) })}\n`,
    );
    execFileSync(
      process.execPath,
      [
        fileURLToPath(REDACT_SCRIPT),
        inputDir,
        outputDir,
        "--home",
        "/home/tester",
      ],
      { encoding: "utf8" },
    );
    const output = JSON.parse(
      JSON.parse(readFileSync(join(outputDir, "ids.ndjson"), "utf8")).line,
    );
    expect(output.authMethods).toEqual([
      { id: "cached_token", name: "Sign in (cached_token)" },
    ]);
    expect(output.authToken).toBe("REDACTED");
    expect(output.update.rawInput).toEqual({
      subagent_id: "child-alpha",
      task_id: "child-alpha",
      task_ids: ["child-alpha"],
      delivery: "interject",
      text: "REDACTED_TEXT",
    });
    expect(readFileSync(join(outputDir, "ids.ndjson"), "utf8")).not.toContain(
      token,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("refuses an output directory that contains the input recordings", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-recording-redact-parent-"));
  const inputDir = join(root, "raw");
  const sibling = join(root, "sibling.txt");
  try {
    mkdirSync(inputDir);
    writeFileSync(
      join(inputDir, "session.ndjson"),
      `${JSON.stringify({ line: JSON.stringify({ ok: true }) })}\n`,
    );
    writeFileSync(sibling, "keep-me");

    expect(() =>
      execFileSync(
        process.execPath,
        [
          fileURLToPath(REDACT_SCRIPT),
          inputDir,
          root,
          "--home",
          "/home/tester",
        ],
        { encoding: "utf8" },
      ),
    ).toThrow(/contains the input recordings/);
    expect(readFileSync(sibling, "utf8")).toBe("keep-me");
    expect(readFileSync(join(inputDir, "session.ndjson"), "utf8")).toContain(
      "ok",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("redacts Grok plan content and denial comments", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-recording-redact-plan-"));
  const inputDir = join(root, "input");
  const outputDir = join(root, "output");
  const plan = "Private plan for the customer project";
  const comments = "Private rejection: do not ship this";
  try {
    mkdirSync(inputDir);
    writeFileSync(
      join(inputDir, "plan.ndjson"),
      [
        JSON.stringify({
          line: JSON.stringify({
            jsonrpc: "2.0",
            id: 7,
            method: "_x.ai/exit_plan_mode",
            params: {
              sessionId: "session-1",
              toolCallId: "tool-1",
              planContent: plan,
            },
          }),
        }),
        JSON.stringify({
          line: JSON.stringify({
            jsonrpc: "2.0",
            id: 7,
            result: { outcome: "cancelled", comments },
          }),
        }),
      ].join("\n") + "\n",
    );

    const stdout = execFileSync(
      process.execPath,
      [
        fileURLToPath(REDACT_SCRIPT),
        inputDir,
        outputDir,
        "--home",
        "/home/tester",
      ],
      { encoding: "utf8" },
    );
    const output = readFileSync(join(outputDir, "plan.ndjson"), "utf8");

    expect(stdout).toContain("0 survivors");
    expect(output).not.toContain(plan);
    expect(output).not.toContain(comments);
    expect(output).toContain("REDACTED_TEXT");
    expect(output).toContain("session-1");
    expect(output).toContain("tool-1");
    expect(output).toContain("cancelled");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("refuses an output directory that contains a symlinked input", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-recording-redact-link-"));
  const outputDir = join(root, "run");
  const inputDir = join(outputDir, "raw");
  const inputLink = join(root, "input");
  const sibling = join(outputDir, "sibling.txt");
  try {
    mkdirSync(inputDir, { recursive: true });
    writeFileSync(
      join(inputDir, "session.ndjson"),
      `${JSON.stringify({ line: JSON.stringify({ ok: true }) })}\n`,
    );
    writeFileSync(sibling, "keep-me");
    symlinkSync(inputDir, inputLink);

    expect(() =>
      execFileSync(
        process.execPath,
        [
          fileURLToPath(REDACT_SCRIPT),
          inputLink,
          outputDir,
          "--home",
          "/home/tester",
        ],
        { encoding: "utf8" },
      ),
    ).toThrow(/contains the input recordings/);
    expect(readFileSync(sibling, "utf8")).toBe("keep-me");
    expect(readFileSync(join(inputDir, "session.ndjson"), "utf8")).toContain(
      "ok",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
