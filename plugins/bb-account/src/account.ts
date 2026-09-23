import type { PluginLogger } from "@get-bb/plugin-sdk";
import { serverUrlForHandle } from "@bb/connect-client";
import { normalizeOrigin } from "./base-url.js";
import {
  FETCH_BODY_MAX_BYTES,
  LONG_POLL_TIMEOUT_MS,
  type AccountFetchInput,
  type AccountFetchResult,
  type AccountStatus,
} from "./contract.js";
import { assertAllowedFetchPath } from "./fetch-path.js";
import {
  authenticatedFetch,
  disconnectServer,
  fetchProfile,
  redeemCode as redeemHostedCode,
  type AccountProfile,
} from "./hosted.js";
import type { AccountStore, StoredCredential } from "./store.js";

const PROFILE_REFRESH_MS = 6 * 60 * 60 * 1000;
const PROFILE_RETRY_MIN_MS = 30_000;
const PROFILE_RETRY_MAX_MS = 15 * 60 * 1000;

export type AccountErrorCode =
  | "network"
  | "unauthorized"
  | "profile_unavailable";

export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

export interface CompleteSignInArgs {
  baseUrl: string;
  credential: string;
  serverId: string | null;
  serverUrl: string | null;
}

interface AccountServiceOptions {
  store: AccountStore;
  log: PluginLogger;
  onChange(status: AccountStatus): void;
}

type ProfileRefreshOutcome = "ok" | "failed" | "signed-out" | "none";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function signedOutResponse(): AccountFetchResult {
  return { status: 401, body: { error: "signed-out" } };
}

export class AccountService {
  private credential: StoredCredential | null = null;
  private profile: AccountProfile | null = null;
  private revision = 0;
  private readonly waiters = new Set<() => void>();
  private mutations: Promise<unknown> = Promise.resolve();
  private revisionWrites: Promise<unknown> = Promise.resolve();
  private wakeProfileRefresh: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly options: AccountServiceOptions) {}

  async load(): Promise<void> {
    this.credential = await this.options.store.readCredential();
    const profile =
      this.credential === null ? null : await this.options.store.readProfile();
    this.profile =
      profile !== null && profile.serverId === this.credential?.serverId
        ? profile
        : null;
    this.revision = (await this.options.store.readRevision()) + 1;
    await this.options.store.writeRevision(this.revision);
  }

  status(): AccountStatus {
    const credential = this.credential;
    const profile = this.profile;
    if (credential === null || profile === null) {
      return { state: "signed-out", revision: this.revision, account: null };
    }
    return {
      state: "signed-in",
      revision: this.revision,
      account: {
        userId: profile.userId,
        githubLogin: profile.githubLogin,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        handle: profile.handle,
        serverId: profile.serverId,
        serverLabel: profile.serverLabel,
        serverUrl: credential.serverUrl,
        baseUrl: credential.baseUrl,
      },
    };
  }

  hasCredential(): boolean {
    return this.credential !== null;
  }

  waitForStatusChange(afterRevision: number): Promise<AccountStatus> {
    if (this.revision > afterRevision || this.disposed) {
      return Promise.resolve(this.status());
    }
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.waiters.delete(finish);
        resolve(this.status());
      };
      const timer = setTimeout(finish, LONG_POLL_TIMEOUT_MS);
      timer.unref?.();
      this.waiters.add(finish);
    });
  }

  async fetch(input: AccountFetchInput): Promise<AccountFetchResult> {
    const path = assertAllowedFetchPath(input.path);
    if (input.method === "GET" && input.body !== null) {
      throw new Error("bb-account.v1.fetch: a GET request cannot carry a body");
    }
    const bodyText = input.body === null ? null : JSON.stringify(input.body);
    if (
      bodyText !== null &&
      Buffer.byteLength(bodyText, "utf8") > FETCH_BODY_MAX_BYTES
    ) {
      throw new Error("bb-account.v1.fetch: the request body exceeds 1 MB");
    }
    const status = this.status();
    const credential = this.credential;
    if (status.state !== "signed-in" || credential === null) {
      return signedOutResponse();
    }
    const origin =
      input.target === "api"
        ? status.account.baseUrl
        : status.account.serverUrl;
    const result = await authenticatedFetch({
      origin,
      method: input.method,
      path,
      bodyText,
      credential: credential.credential,
    });
    if (result.status === 401) {
      await this.rejectCredential(
        credential.credential,
        `${input.method} ${input.target} ${path}`,
      );
    }
    return result;
  }

  async adoptConnectCredential(input: {
    credential: string;
    baseUrl: string;
  }): Promise<{ adopted: boolean }> {
    if (this.credential !== null) return { adopted: false };
    const baseUrl = normalizeOrigin(input.baseUrl, "baseUrl");
    const me = await fetchProfile(baseUrl, input.credential);
    if (me.kind === "unauthorized") {
      this.options.log.info(
        "getbb.app rejected the legacy connect pairing, so it was not adopted",
      );
      return { adopted: false };
    }
    return this.serialize(async () => {
      if (this.credential !== null) return { adopted: false };
      await this.storeAccount(
        {
          baseUrl,
          serverUrl: me.profile.serverUrl,
          serverId: me.profile.serverId,
          credential: input.credential,
        },
        me.profile,
      );
      this.options.log.info("adopted the legacy connect pairing");
      return { adopted: true };
    });
  }

  async redeemCode(code: string, baseUrl: string): Promise<AccountStatus> {
    const redeemed = await redeemHostedCode(baseUrl, code);
    return this.completeSignIn({
      baseUrl,
      credential: redeemed.credential,
      serverId: redeemed.serverId,
      serverUrl:
        redeemed.handle === null
          ? null
          : serverUrlForHandle(baseUrl, redeemed.handle),
    });
  }

  async completeSignIn(args: CompleteSignInArgs): Promise<AccountStatus> {
    let me: Awaited<ReturnType<typeof fetchProfile>>;
    try {
      me = await fetchProfile(args.baseUrl, args.credential);
    } catch (error) {
      if (args.serverId !== null && args.serverUrl !== null) {
        const fallback: StoredCredential = {
          baseUrl: args.baseUrl,
          serverUrl: args.serverUrl,
          serverId: args.serverId,
          credential: args.credential,
        };
        await this.serialize(() => this.storeAccount(fallback, null));
        this.wakeProfileRefresh?.();
        throw new AccountError(
          "profile_unavailable",
          `bb saved the new pairing, but getbb.app didn't return the account profile (${errorMessage(error)}). bb keeps retrying.`,
        );
      }
      throw new AccountError("network", errorMessage(error));
    }
    if (me.kind === "unauthorized") {
      throw new AccountError(
        "unauthorized",
        "getbb.app rejected the new server credential",
      );
    }
    const profile = me.profile;
    await this.serialize(() =>
      this.storeAccount(
        {
          baseUrl: args.baseUrl,
          serverUrl: profile.serverUrl,
          serverId: profile.serverId,
          credential: args.credential,
        },
        profile,
      ),
    );
    return this.status();
  }

  async signOut(): Promise<AccountStatus> {
    const credential = this.credential;
    if (credential === null) return this.status();
    try {
      await disconnectServer(credential.serverUrl, credential.credential);
    } catch (error) {
      this.options.log.warn(
        `getbb.app did not confirm the sign-out: ${errorMessage(error)}`,
      );
    }
    await this.serialize(async () => {
      if (this.credential?.credential !== credential.credential) return;
      await this.options.store.clear();
      this.credential = null;
      this.profile = null;
      this.changed();
    });
    return this.status();
  }

  async refreshProfile(): Promise<ProfileRefreshOutcome> {
    const credential = this.credential;
    if (credential === null) return "none";
    let me: Awaited<ReturnType<typeof fetchProfile>>;
    try {
      me = await fetchProfile(credential.baseUrl, credential.credential);
    } catch (error) {
      this.options.log.warn(
        `could not refresh the bb account profile: ${errorMessage(error)}`,
      );
      return "failed";
    }
    if (me.kind === "unauthorized") {
      await this.rejectCredential(
        credential.credential,
        "GET api /api/account/me",
      );
      return "signed-out";
    }
    const profile = me.profile;
    await this.serialize(async () => {
      const current = this.credential;
      if (current?.credential !== credential.credential) return;
      await this.storeAccount(
        {
          ...current,
          serverUrl: profile.serverUrl,
          serverId: profile.serverId,
        },
        profile,
      );
    });
    return "ok";
  }

  async runProfileRefresh(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted && !this.disposed) {
      const outcome = await this.refreshProfile();
      if (outcome === "failed") {
        failures += 1;
      } else {
        failures = 0;
      }
      const delay =
        failures === 0
          ? PROFILE_REFRESH_MS
          : Math.min(
              PROFILE_RETRY_MIN_MS * 2 ** (failures - 1),
              PROFILE_RETRY_MAX_MS,
            );
      await this.sleepUntilWoken(delay, signal);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const waiter of [...this.waiters]) waiter();
    this.wakeProfileRefresh?.();
  }

  private sleepUntilWoken(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        if (this.wakeProfileRefresh === finish) this.wakeProfileRefresh = null;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      timer.unref?.();
      signal.addEventListener("abort", finish, { once: true });
      this.wakeProfileRefresh = finish;
      if (signal.aborted || this.disposed) finish();
    });
  }

  private async rejectCredential(
    credential: string,
    context: string,
  ): Promise<void> {
    await this.serialize(async () => {
      if (this.credential?.credential !== credential) return;
      this.options.log.warn(
        `getbb.app rejected this bb's credential (HTTP 401 on ${context}); signed out`,
      );
      await this.options.store.clear();
      this.credential = null;
      this.profile = null;
      this.changed();
    });
  }

  private async storeAccount(
    credential: StoredCredential,
    profile: AccountProfile | null,
  ): Promise<void> {
    await this.options.store.writeAccount(credential, profile);
    this.credential = credential;
    this.profile = profile;
    this.changed();
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutations.then(work, work);
    this.mutations = next.catch(() => undefined);
    return next;
  }

  private changed(): void {
    this.revision += 1;
    const revision = this.revision;
    this.revisionWrites = this.revisionWrites
      .then(() => this.options.store.writeRevision(revision))
      .catch((error: unknown) => {
        this.options.log.warn(
          `could not persist the bb account revision: ${errorMessage(error)}`,
        );
      });
    const status = this.status();
    this.options.onChange(status);
    for (const waiter of [...this.waiters]) waiter();
  }
}
