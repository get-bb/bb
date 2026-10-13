import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireTextInput, resolveTextInput } from "../text-input.js";

const labels = {
  fileLabel: "--message-file",
  inlineLabel: "<message>",
};

describe("resolveTextInput", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bb-text-input-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("delivers shell-active characters from a file byte for byte", async () => {
    const path = join(dir, "message.md");
    const message = 'Run `git rebase --onto main` and $(date) then "quote"';
    writeFileSync(path, `${message}\n\n`);
    expect(
      await resolveTextInput({ ...labels, file: path, inline: undefined }),
    ).toBe(message);
  });

  it("reads stdin for -", async () => {
    expect(
      await resolveTextInput({
        ...labels,
        file: "-",
        inline: undefined,
        stdin: Readable.from([Buffer.from("line one\n"), "line two\n"]),
      }),
    ).toBe("line one\nline two");
  });

  it("refuses - when stdin is a terminal instead of hanging", async () => {
    const stdin = Object.assign(Readable.from([]), { isTTY: true });
    await expect(
      resolveTextInput({ ...labels, file: "-", inline: undefined, stdin }),
    ).rejects.toThrow("--message-file - reads stdin, but stdin is a terminal.");
  });

  it("refuses both an inline message and a file", async () => {
    await expect(
      resolveTextInput({ ...labels, file: join(dir, "x"), inline: "hi" }),
    ).rejects.toThrow("Provide only one of <message> or --message-file.");
  });

  it("refuses a missing file and a blank file", async () => {
    await expect(
      resolveTextInput({
        ...labels,
        file: join(dir, "missing.md"),
        inline: undefined,
      }),
    ).rejects.toThrow("Could not read --message-file");

    const blank = join(dir, "blank.md");
    writeFileSync(blank, " \n\n");
    await expect(
      resolveTextInput({ ...labels, file: blank, inline: undefined }),
    ).rejects.toThrow(`--message-file '${blank}' is empty.`);
  });

  it("names both ways to pass the text when neither was given", async () => {
    await expect(
      requireTextInput({ ...labels, file: undefined, inline: undefined }),
    ).rejects.toMatchObject({
      code: "missing_required",
      hint: "Pass <message>, or --message-file <path> (use - to read stdin).",
      message: "Missing <message>.",
    });
  });
});
