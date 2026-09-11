import { execFile } from "node:child_process";
import { pbkdf2Sync } from "node:crypto";
import { BrowserImportError } from "./cookie-database.js";

const KEY_SALT = "saltysalt";
const KEY_LENGTH = 16;
const MAC_KEY_ITERATIONS = 1003;
const LINUX_KEY_ITERATIONS = 1;
const LINUX_FALLBACK_PASSPHRASE = "peanuts";

export interface ChromiumKeyMaterial {
  cbcV10?: Buffer;
  cbcV11?: Buffer;
  cbcV11Error?: BrowserImportError;
  cbcEmpty?: Buffer;
}

export interface ChromiumKeyRequest {
  platform: NodeJS.Platform;
  keychainService: string | undefined;
  keychainAccount: string | undefined;
  linuxSecretApplication: string | undefined;
}

export interface SecretCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  spawnError?: NodeJS.ErrnoException;
}

export type SecretCommandRunner = (
  file: string,
  args: string[],
) => Promise<SecretCommandResult>;

export const runSecretCommand: SecretCommandRunner = (file, args) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && !("code" in error && typeof error.code === "number")) {
          resolve({
            stdout,
            stderr,
            exitCode: null,
            spawnError: error as NodeJS.ErrnoException,
          });
          return;
        }
        resolve({
          stdout,
          stderr,
          exitCode: error
            ? typeof error.code === "number"
              ? error.code
              : 1
            : 0,
        });
      },
    );
  });

export function deriveChromiumKey(
  passphrase: string,
  iterations: number,
): Buffer {
  return pbkdf2Sync(passphrase, KEY_SALT, iterations, KEY_LENGTH, "sha1");
}

export async function readMacKeychainSecret(
  service: string,
  account: string,
  run: SecretCommandRunner = runSecretCommand,
): Promise<string> {
  const result = await run("/usr/bin/security", [
    "find-generic-password",
    "-w",
    "-s",
    service,
    "-a",
    account,
  ]);
  if (result.spawnError) {
    throw new BrowserImportError("keychainUnavailable", undefined, {
      cause: result.spawnError,
    });
  }
  if (result.exitCode !== 0) {
    const stderr = result.stderr;
    if (/could not be found|item not found|errSecItemNotFound/i.test(stderr))
      throw new BrowserImportError("keychainItemMissing");
    if (result.exitCode === 44)
      throw new BrowserImportError("keychainItemMissing");
    throw new BrowserImportError("needsKeychainApproval", stderr.trim());
  }
  const secret = result.stdout.replace(/\r?\n$/, "");
  if (secret.length === 0) throw new BrowserImportError("keychainItemMissing");
  return secret;
}

export async function readLinuxSecret(
  application: string,
  run: SecretCommandRunner = runSecretCommand,
): Promise<string> {
  const result = await run("secret-tool", [
    "lookup",
    "application",
    application,
  ]);
  if (result.spawnError) {
    throw new BrowserImportError("keychainUnavailable", undefined, {
      cause: result.spawnError,
    });
  }
  if (result.exitCode !== 0) {
    if (/dismissed|cancel|denied|locked/i.test(result.stderr))
      throw new BrowserImportError("needsKeychainApproval", result.stderr);
    throw new BrowserImportError("keychainUnavailable", result.stderr.trim());
  }
  const secret = result.stdout.replace(/\r?\n$/, "");
  if (secret.length === 0) throw new BrowserImportError("keychainItemMissing");
  return secret;
}

export async function resolveChromiumKeys(
  request: ChromiumKeyRequest,
  run: SecretCommandRunner = runSecretCommand,
): Promise<ChromiumKeyMaterial> {
  if (request.platform === "darwin") {
    if (!request.keychainService || !request.keychainAccount)
      throw new BrowserImportError("unsupportedPlatform");
    const secret = await readMacKeychainSecret(
      request.keychainService,
      request.keychainAccount,
      run,
    );
    return { cbcV10: deriveChromiumKey(secret, MAC_KEY_ITERATIONS) };
  }
  if (request.platform === "linux") {
    const material: ChromiumKeyMaterial = {
      cbcV10: deriveChromiumKey(
        LINUX_FALLBACK_PASSPHRASE,
        LINUX_KEY_ITERATIONS,
      ),
      cbcEmpty: deriveChromiumKey("", LINUX_KEY_ITERATIONS),
    };
    if (request.linuxSecretApplication) {
      try {
        const secret = await readLinuxSecret(
          request.linuxSecretApplication,
          run,
        );
        material.cbcV11 = deriveChromiumKey(secret, LINUX_KEY_ITERATIONS);
      } catch (error) {
        if (!(error instanceof BrowserImportError)) throw error;
        if (error.reason === "needsKeychainApproval") throw error;
        material.cbcV11Error = error;
      }
    }
    return material;
  }
  throw new BrowserImportError("unsupportedPlatform");
}
