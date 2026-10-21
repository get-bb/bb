import type { PluginLogger } from "@get-bb/plugin-sdk";
import {
  AccountUnavailableError,
  type Account,
  type AccountClient,
} from "./account-client.js";
import type { CredentialCopy } from "./credential-copy.js";

interface AccountLinkOptions {
  account: AccountClient;
  copy: CredentialCopy;
  log: PluginLogger;
  onAccount(account: Account | null): void;
}

export class AccountLink {
  constructor(private readonly options: AccountLinkOptions) {}

  async run(signal: AbortSignal): Promise<void> {
    const watch = this.options.account.watchStatus({
      signal,
      prepare: async (status) => {
        if (await this.options.copy.sync(status)) watch.refresh();
      },
      onChange: (status) => this.options.onAccount(status.account),
      onError: (error) => {
        if (error instanceof AccountUnavailableError)
          this.options.onAccount(null);
        else
          this.options.log.warn(
            `could not read the bb account status: ${error.message}`,
          );
      },
    });
    try {
      if (!signal.aborted)
        await new Promise<void>((done) =>
          signal.addEventListener("abort", () => done(), { once: true }),
        );
    } finally {
      watch();
      await watch.done;
    }
  }
}
