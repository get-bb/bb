import type { PluginLogger } from "@get-bb/plugin-sdk";
import { deriveConnectBaseUrl } from "@bb/connect-client";
import {
  AccountUnavailableError,
  type Account,
  type AccountClient,
  type AccountStatus,
} from "./account-client.js";
import type { LegacyCredentialStore } from "./legacy-credential.js";

const ADOPTION_RETRY_MS = 60_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

interface AccountLinkOptions {
  account: AccountClient;
  legacy: LegacyCredentialStore;
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
  private legacyChecked = false;
  private lastAdoptionAttemptAt: number | null = null;

  constructor(private readonly options: AccountLinkOptions) {}

  async run(signal: AbortSignal): Promise<void> {
    let revision: number | null = null;
    let failures = 0;
    while (!signal.aborted) {
      try {
        const status: AccountStatus =
          revision === null
            ? await this.options.account.status(signal)
            : await this.options.account.waitForStatusChange(revision, signal);
        if (signal.aborted) return;
        failures = 0;
        if (await this.migrateLegacyCredential(status)) {
          revision = null;
          continue;
        }
        revision = status.revision;
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
        failures += 1;
        const base = this.options.retryMinMs ?? RETRY_MIN_MS;
        await sleep(Math.min(base * 2 ** (failures - 1), RETRY_MAX_MS), signal);
      }
    }
  }

  private async migrateLegacyCredential(
    status: AccountStatus,
  ): Promise<boolean> {
    if (this.legacyChecked) return false;
    const legacy = await this.options.legacy.read();
    if (legacy === null) {
      this.legacyChecked = true;
      return false;
    }
    if (status.state === "signed-in") {
      await this.options.legacy.clear();
      this.legacyChecked = true;
      this.options.log.info(
        "bb account is signed in, so connect removed its old pairing",
      );
      return false;
    }
    const now = Date.now();
    if (
      this.lastAdoptionAttemptAt !== null &&
      now - this.lastAdoptionAttemptAt < ADOPTION_RETRY_MS
    ) {
      return false;
    }
    this.lastAdoptionAttemptAt = now;
    let adopted: boolean;
    try {
      ({ adopted } = await this.options.account.adoptConnectCredential({
        credential: legacy.credential,
        serverUrl: legacy.serverUrl,
        handle: legacy.handle,
        baseUrl: deriveConnectBaseUrl(legacy.serverUrl),
      }));
    } catch (error) {
      this.options.log.warn(
        `could not move connect's pairing into bb account yet: ${errorMessage(error)}`,
      );
      return false;
    }
    await this.options.legacy.clear();
    this.legacyChecked = true;
    this.options.log.info(
      adopted
        ? "moved connect's pairing into bb account"
        : "bb account didn't take connect's old pairing, so connect removed it",
    );
    return true;
  }
}
