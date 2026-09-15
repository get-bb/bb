import { StringDecoder } from "node:string_decoder";
import { SERVER_EXPORT_PASSPHRASE_MIN_LENGTH } from "@bb/server-contract";
import { CliExitError } from "../action.js";

export const SERVER_EXPORT_PASSPHRASE_ENV = "BB_SERVER_EXPORT_PASSPHRASE";

type ChunkListener = (chunk: Buffer | string) => void;

export interface PassphraseInput {
  readonly isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  on(event: "data", listener: ChunkListener): unknown;
  on(event: "end", listener: () => void): unknown;
  off(event: "data", listener: ChunkListener): unknown;
  off(event: "end", listener: () => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

export interface PassphraseTerminal {
  input: PassphraseInput;
  output: { write(text: string): unknown };
}

export interface ReadPassphraseArgs {
  env: NodeJS.ProcessEnv;
  terminal: PassphraseTerminal;
}

const CARRIAGE_RETURN = "\r";
const LINE_FEED = "\n";
const END_OF_TEXT = "\u0003";
const END_OF_TRANSMISSION = "\u0004";
const BACKSPACE = "\b";
const DELETE = "\u007f";
const ESCAPE = "\u001b";

export function processPassphraseTerminal(): PassphraseTerminal {
  return { input: process.stdin, output: process.stderr };
}

function isInteractive(terminal: PassphraseTerminal): boolean {
  return (
    terminal.input.isTTY === true &&
    typeof terminal.input.setRawMode === "function"
  );
}

export function readHiddenLine(
  terminal: PassphraseTerminal,
  prompt: string,
): Promise<string> {
  const { input, output } = terminal;
  if (!isInteractive(terminal)) {
    return Promise.reject(
      new Error("A passphrase prompt needs an interactive terminal."),
    );
  }
  output.write(prompt);
  input.setRawMode?.(true);
  input.resume();
  return new Promise<string>((resolve, reject) => {
    const decoder = new StringDecoder("utf8");
    let value = "";
    const finish = (error: Error | null): void => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.setRawMode?.(false);
      input.pause();
      output.write(LINE_FEED);
      if (error === null) {
        resolve(value);
      } else {
        reject(error);
      }
    };
    const onEnd = (): void => {
      finish(new Error("The terminal closed before a passphrase was entered."));
    };
    const onData = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
      if (text.startsWith(ESCAPE)) return;
      for (const character of text) {
        if (
          character === CARRIAGE_RETURN ||
          character === LINE_FEED ||
          character === END_OF_TRANSMISSION
        ) {
          finish(null);
          return;
        }
        if (character === END_OF_TEXT) {
          finish(new CliExitError("Cancelled", 130));
          return;
        }
        if (character === DELETE || character === BACKSPACE) {
          value = Array.from(value).slice(0, -1).join("");
          continue;
        }
        if (character < " ") continue;
        value += character;
      }
    };
    input.on("data", onData);
    input.on("end", onEnd);
  });
}

function passphraseFromEnv(env: NodeJS.ProcessEnv): string | null {
  const value = env[SERVER_EXPORT_PASSPHRASE_ENV];
  if (value === undefined) return null;
  if (value.length === 0) {
    throw new Error(`${SERVER_EXPORT_PASSPHRASE_ENV} must not be empty.`);
  }
  return value;
}

function assertExportPassphraseLength(
  passphrase: string,
  subject: string,
): void {
  if (passphrase.length < SERVER_EXPORT_PASSPHRASE_MIN_LENGTH) {
    throw new Error(
      `${subject} must be at least ${String(SERVER_EXPORT_PASSPHRASE_MIN_LENGTH)} characters.`,
    );
  }
}

export async function readNewExportPassphrase(
  args: ReadPassphraseArgs,
): Promise<string> {
  const fromEnv = passphraseFromEnv(args.env);
  if (fromEnv !== null) {
    assertExportPassphraseLength(fromEnv, SERVER_EXPORT_PASSPHRASE_ENV);
    return fromEnv;
  }
  if (!isInteractive(args.terminal)) {
    throw new Error(
      `Set ${SERVER_EXPORT_PASSPHRASE_ENV} or run this command in an interactive terminal to enter a passphrase. Pass --unencrypted to export without encryption.`,
    );
  }
  const passphrase = await readHiddenLine(args.terminal, "Export passphrase: ");
  assertExportPassphraseLength(passphrase, "The export passphrase");
  const repeated = await readHiddenLine(
    args.terminal,
    "Repeat the passphrase: ",
  );
  if (repeated !== passphrase) {
    throw new Error("The passphrases do not match.");
  }
  return passphrase;
}

export async function readArchivePassphrase(
  args: ReadPassphraseArgs,
): Promise<string> {
  const fromEnv = passphraseFromEnv(args.env);
  if (fromEnv !== null) return fromEnv;
  if (!isInteractive(args.terminal)) {
    throw new Error(
      `This export is encrypted. Set ${SERVER_EXPORT_PASSPHRASE_ENV} or run this command in an interactive terminal to enter its passphrase.`,
    );
  }
  const passphrase = await readHiddenLine(args.terminal, "Export passphrase: ");
  if (passphrase.length === 0) {
    throw new Error("The passphrase must not be empty.");
  }
  return passphrase;
}
