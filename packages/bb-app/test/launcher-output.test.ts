import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function renderOutput(tty: boolean, overrides: NodeJS.ProcessEnv): string {
  const env = { ...process.env };
  for (const key of ["NO_COLOR", "FORCE_COLOR", "CI", "TERM"]) {
    delete env[key];
  }
  return execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        process.stdout.isTTY = ${tty};
        const { beginStep, endStep, green } = await import(${JSON.stringify(new URL("../src/launcher-output.ts", import.meta.url).href)});
        beginStep("Starting server");
        endStep(green("✓"), "Server listening");
      `,
    ],
    { encoding: "utf8", env: { ...env, ...overrides } },
  );
}

const plainOutput = "  ○  Starting server\n  ✓  Server listening\n";

describe("launcher output", () => {
  it.each([{}, { CI: "1" }, { NO_COLOR: "1" }])(
    "keeps redirected progress readable with %j",
    (env) => {
      expect(renderOutput(false, env)).toBe(plainOutput);
    },
  );

  it("allows forced color in a pipe without cursor controls", () => {
    const output = renderOutput(false, { FORCE_COLOR: "1" });
    expect(output).toContain("\x1b[32m✓\x1b[39m");
    expect(output).not.toContain("\x1b[2K");
    expect(output).not.toContain("\r");
    expect(output.split("\n")).toHaveLength(3);
  });

  it("honors NO_COLOR when color is also forced", () => {
    expect(renderOutput(false, { FORCE_COLOR: "1", NO_COLOR: "1" })).toBe(
      plainOutput,
    );
  });

  it("retains colored in-place progress on a terminal", () => {
    const output = renderOutput(true, { TERM: "xterm-256color" });
    expect(output).toContain("\x1b[32m✓\x1b[39m");
    expect(output).toContain("Starting server\r\x1b[2K");
  });

  it("disables terminal color independently of cursor controls", () => {
    expect(renderOutput(true, { NO_COLOR: "1" })).toBe(
      "\x1b[2K  ○  Starting server\r\x1b[2K  ✓  Server listening\n",
    );
  });
});
