import type { PluginLogger } from "@get-bb/plugin-sdk";
import {
  AccountUnavailableError,
  type Account,
  type AccountClient,
  type AccountStatus,
} from "./account-client.js";
import type { CredentialCopy } from "./credential-copy.js";

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

interface AccountLinkOptions {
  account: AccountClient;
  copy: CredentialCopy;
  log: PluginLogger;
  onAccount(account: Account | null): void;
  retryMinMs?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    signal.addEventListener("abort", finish, { once: true });
  });
}

export class AccountLink {
  constructor(private readonly options: AccountLinkOptions) {}

  async run(signal: AbortSignal): Promise<void> {
    let revision: number | null = null;
    let syncedRevision: number | null = null;
    let failures = 0;
    while (!signal.aborted) {
      try {
        const status: AccountStatus =
          revision === null
            ? await this.options.account.status(signal)
            : await this.options.account.waitForStatusChange(revision, signal);
        if (signal.aborted) return;
        if (status.revision !== syncedRevision) {
          syncedRevision = status.revision;
          if (await this.options.copy.sync(status)) {
            revision = null;
            continue;
          }
        }
        revision = status.revision;
        failures = 0;
        this.options.onAccount(status.account);
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof AccountUnavailableError) {
          this.options.onAccount(null);
        } else {
          this.options.log.warn(
            `could not read the bb account status: ${errorMessage(error)}`,
          );
        }
        revision = null;
        syncedRevision = null;
        failures += 1;
        const base = this.options.retryMinMs ?? RETRY_MIN_MS;
        await sleep(Math.min(base * 2 ** (failures - 1), RETRY_MAX_MS), signal);
      }
    }
  }
}
