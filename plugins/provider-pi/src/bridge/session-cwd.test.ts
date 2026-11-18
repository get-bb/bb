import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  piSessionNeedsRelocation,
  readPiSessionFileState,
} from "./session-cwd.js";

it("does not modify a session when its requested directory or header is invalid", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-pi-relocation-invalid-"));
  const file = join(root, "session.jsonl");
  try {
    const contents = JSON.stringify({ type: "session", cwd: root }) + "\n";
    writeFileSync(file, contents);
    expect(() =>
      piSessionNeedsRelocation(file, join(root, "missing")),
    ).toThrow();
    expect(readFileSync(file, "utf8")).toBe(contents);
    expect(() => piSessionNeedsRelocation(file, file)).toThrow(
      "not a directory",
    );
    expect(readFileSync(file, "utf8")).toBe(contents);
    writeFileSync(file, "invalid header\nuntouched history\n");
    expect(() => piSessionNeedsRelocation(file, root)).toThrow();
    expect(readFileSync(file, "utf8")).toBe(
      "invalid header\nuntouched history\n",
    );
    expect(readdirSync(root)).toEqual(["session.jsonl"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("requires relocation only for a different directory", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-pi-relocation-file-"));
  const file = join(root, "session.jsonl");
  try {
    expect(piSessionNeedsRelocation(file, root)).toBe(false);
    writeFileSync(
      file,
      JSON.stringify({ type: "session", cwd: realpathSync(root) }),
    );
    expect(piSessionNeedsRelocation(file, root)).toBe(false);
    const contents = JSON.stringify({
      type: "session",
      cwd: join(root, "removed"),
    });
    writeFileSync(file, contents);
    expect(piSessionNeedsRelocation(file, root)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(contents);
    expect(readdirSync(root)).toEqual(["session.jsonl"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("judges a session file the way pi does when it opens one", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-pi-session-state-"));
  const file = join(root, "session.jsonl");
  const header = JSON.stringify({ type: "session", id: "abc", cwd: root });
  try {
    expect(readPiSessionFileState(file)).toBe("missing");
    writeFileSync(file, "");
    expect(readPiSessionFileState(file)).toBe("valid");
    writeFileSync(file, `\n{truncated\n${header}\n`);
    expect(readPiSessionFileState(file)).toBe("valid");
    writeFileSync(file, "not a pi session\n");
    expect(readPiSessionFileState(file)).toBe("invalid");
    writeFileSync(file, `${JSON.stringify({ type: "message" })}\n${header}\n`);
    expect(readPiSessionFileState(file)).toBe("invalid");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
