import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CliExitError } from "../action.js";
import {
  readArchivePassphrase,
  readHiddenLine,
  readNewExportPassphrase,
  type PassphraseTerminal,
} from "../commands/server-passphrase.js";

function fakeTerminal(isTTY = true) {
  const input = Object.assign(new PassThrough(), {
    isTTY,
    setRawMode: vi.fn(),
  });
  const written: string[] = [];
  const terminal: PassphraseTerminal = {
    input,
    output: { write: (text: string) => written.push(text) },
  };
  return { input, terminal, written };
}

describe("server passphrase prompts", () => {
  it("reads a hidden line in raw mode, applies backspace, and restores the terminal", async () => {
    const { input, terminal, written } = fakeTerminal();

    const line = readHiddenLine(terminal, "Passphrase: ");
    input.write("pasx\u007fs wörd\r");

    await expect(line).resolves.toBe("pass wörd");
    expect(written).toEqual(["Passphrase: ", "\n"]);
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.isPaused()).toBe(true);
  });

  it("decodes a multibyte character split across chunks", async () => {
    const { input, terminal } = fakeTerminal();
    const bytes = Buffer.from("ö", "utf8");

    const line = readHiddenLine(terminal, "Passphrase: ");
    input.write(bytes.subarray(0, 1));
    input.write(Buffer.concat([bytes.subarray(1), Buffer.from("\r")]));

    await expect(line).resolves.toBe("ö");
  });

  it("cancels with exit code 130 on Ctrl-C", async () => {
    const { input, terminal } = fakeTerminal();

    const line = readHiddenLine(terminal, "Passphrase: ");
    input.write("abc\u0003");

    await expect(line).rejects.toMatchObject({
      constructor: CliExitError,
      exitCode: 130,
    });
    expect(input.setRawMode.mock.calls.at(-1)).toEqual([false]);
  });

  it("asks twice for a new export passphrase and accepts matching entries", async () => {
    const { input, terminal, written } = fakeTerminal();

    const passphrase = readNewExportPassphrase({ env: {}, terminal });
    input.write("hunter22\r");
    await vi.waitFor(() =>
      expect(written).toContain("Repeat the passphrase: "),
    );
    input.write("hunter22\r");

    await expect(passphrase).resolves.toBe("hunter22");
  });

  it("rejects a new export passphrase whose repeat does not match", async () => {
    const { input, terminal, written } = fakeTerminal();

    const passphrase = readNewExportPassphrase({ env: {}, terminal });
    input.write("hunter22\r");
    await vi.waitFor(() =>
      expect(written).toContain("Repeat the passphrase: "),
    );
    input.write("hunter33\r");

    await expect(passphrase).rejects.toThrow("The passphrases do not match.");
  });

  it("rejects a passphrase shorter than 8 characters before asking for the repeat", async () => {
    const { input, terminal, written } = fakeTerminal();

    const passphrase = readNewExportPassphrase({ env: {}, terminal });
    input.write("hunter2\r");

    await expect(passphrase).rejects.toThrow(
      "The export passphrase must be at least 8 characters.",
    );
    expect(written).not.toContain("Repeat the passphrase: ");
  });

  it("rejects a short BB_SERVER_EXPORT_PASSPHRASE for an export without prompting", async () => {
    const { terminal, written } = fakeTerminal();

    await expect(
      readNewExportPassphrase({
        env: { BB_SERVER_EXPORT_PASSPHRASE: "1234567" },
        terminal,
      }),
    ).rejects.toThrow(
      "BB_SERVER_EXPORT_PASSPHRASE must be at least 8 characters.",
    );
    expect(written).toEqual([]);
    await expect(
      readNewExportPassphrase({
        env: { BB_SERVER_EXPORT_PASSPHRASE: "12345678" },
        terminal,
      }),
    ).resolves.toBe("12345678");
  });

  it("prefers BB_SERVER_EXPORT_PASSPHRASE over prompting", async () => {
    const { terminal, written } = fakeTerminal();

    await expect(
      readArchivePassphrase({
        env: { BB_SERVER_EXPORT_PASSPHRASE: "from env" },
        terminal,
      }),
    ).resolves.toBe("from env");
    expect(written).toEqual([]);
  });

  it("refuses to prompt without a terminal", async () => {
    const { terminal } = fakeTerminal(false);

    await expect(readArchivePassphrase({ env: {}, terminal })).rejects.toThrow(
      "This export is encrypted. Set BB_SERVER_EXPORT_PASSPHRASE or run this command in an interactive terminal to enter its passphrase.",
    );
  });
});
