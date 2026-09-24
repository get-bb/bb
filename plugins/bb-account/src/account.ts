import type {
  ExperimentalPluginRpcCaller,
  PluginLogger,
} from "@get-bb/plugin-sdk";
import { serverUrlForHandle } from "@bb/connect-client";
import { normalizeOrigin } from "./base-url.js";
import {
  FETCH_BODY_MAX_BYTES,
  LONG_POLL_TIMEOUT_MS,
  type AccountFetchInput,
  type AccountFetchResult,
  type AccountStatus,
  type SignOutResult,
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
  | "profile_unavailable"
  | "superseded";

export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

export interface SignInAttempt {
  readonly epoch: number;
  committed: boolean;
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
  private signInEpoch = 0;

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
    if (credential === null) {
      return { state: "signed-out", revision: this.revision, account: null };
    }
    if (profile === null) {
      return {
        state: "profile-pending",
        revision: this.revision,
        account: null,
      };
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

  async fetch(
    input: AccountFetchInput,
    caller: ExperimentalPluginRpcCaller,
  ): Promise<AccountFetchResult> {
    const path = assertAllowedFetchPath(input.path, caller);
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
    const credential = this.credential;
    if (credential === null) return signedOutResponse();
    const result = await authenticatedFetch({
      origin:
        input.target === "api" ? credential.baseUrl : credential.serverUrl,
      method: input.method,
      path,
      bodyText,
      credential: credential.credential,
      timeoutMs: input.timeoutMs,
    });
    if (result.status === 401) {
      await this.confirmRejected(
        credential,
        `${input.method} ${input.target} ${path}`,
      );
    }
    return result;
  }

  async adoptConnectCredential(input: {
    credential: string;
    baseUrl: string;
  }): Promise<{ adopted: boolean }> {
    if (this.credential?.credential === input.credential) {
      return { adopted: true };
    }
    const baseUrl = normalizeOrigin(input.baseUrl, "baseUrl");
    const me = await fetchProfile(baseUrl, input.credential);
    if (me.kind === "unauthorized") {
      this.options.log.info(
        "getbb.app rejected the legacy connect pairing, so it was not adopted",
      );
      return { adopted: false };
    }
    const legacy: StoredCredential = {
      baseUrl,
      serverUrl: me.profile.serverUrl,
      serverId: me.profile.serverId,
      credential: input.credential,
    };
    const adopted = await this.serialize(async () => {
      if (this.credential?.credential === input.credential) return true;
      if (this.credential !== null) return false;
      await this.storeAccount(legacy, me.profile);
      return true;
    });
    if (adopted) {
      this.options.log.info("adopted the legacy connect pairing");
      return { adopted: true };
    }
    if (this.credential?.serverId !== legacy.serverId) {
      await disconnectServer(legacy.serverUrl, legacy.credential);
      this.options.log.info(
        "revoked the legacy connect pairing because bb account holds a different one",
      );
    }
    return { adopted: false };
  }

  supersedeSignIns(): SignInAttempt {
    this.signInEpoch += 1;
    return { epoch: this.signInEpoch, committed: false };
  }

  isSignInCurrent(attempt: SignInAttempt): boolean {
    return attempt.epoch === this.signInEpoch;
  }

  abandonSignIn(attempt: SignInAttempt): boolean {
    if (attempt.committed) return false;
    if (attempt.epoch === this.signInEpoch) this.signInEpoch += 1;
    return true;
  }

  async redeemCode(code: string, baseUrl: string): Promise<AccountStatus> {
    const attempt: SignInAttempt = {
      epoch: this.signInEpoch,
      committed: false,
    };
    const redeemed = await redeemHostedCode(baseUrl, code);
    return this.completeSignIn(
      {
        baseUrl,
        credential: redeemed.credential,
        serverId: redeemed.serverId,
        serverUrl:
          redeemed.handle === null
            ? null
            : serverUrlForHandle(baseUrl, redeemed.handle),
      },
      attempt,
    );
  }

  async completeSignIn(
    args: CompleteSignInArgs,
    attempt: SignInAttempt,
  ): Promise<AccountStatus> {
    let me: Awaited<ReturnType<typeof fetchProfile>>;
    try {
      me = await fetchProfile(args.baseUrl, args.credential);
    } catch (error) {
      if (args.serverId !== null && args.serverUrl !== null) {
        await this.commitSignIn(attempt, {
          credential: {
            baseUrl: args.baseUrl,
            serverUrl: args.serverUrl,
            serverId: args.serverId,
            credential: args.credential,
          },
          profile: null,
        });
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
    await this.commitSignIn(attempt, {
      credential: {
        baseUrl: args.baseUrl,
        serverUrl: me.profile.serverUrl,
        serverId: me.profile.serverId,
        credential: args.credential,
      },
      profile: me.profile,
    });
    return this.status();
  }

  async signOut(): Promise<SignOutResult> {
    this.signInEpoch += 1;
    const credential = await this.serialize(async () => this.credential);
    if (credential === null) {
      return { revocation: "not-signed-in", status: this.status() };
    }
    let failure: string | null = null;
    try {
      await disconnectServer(credential.serverUrl, credential.credential);
    } catch (error) {
      failure = errorMessage(error);
      this.options.log.warn(
        `getbb.app did not confirm the sign-out: ${failure}`,
      );
    }
    await this.serialize(async () => {
      if (this.credential?.credential !== credential.credential) return;
      await this.options.store.clear();
      this.credential = null;
      this.profile = null;
      this.changed();
    });
    const status = this.status();
    return failure === null
      ? { revocation: "revoked", status }
      : {
          revocation: "failed",
          status,
          message: failure,
          dashboardUrl: `${credential.baseUrl}/dashboard`,
        };
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

  private async commitSignIn(
    attempt: SignInAttempt,
    next: { credential: StoredCredential; profile: AccountProfile | null },
  ): Promise<void> {
    const outcome = await this.serialize(async () => {
      if (attempt.epoch !== this.signInEpoch) return null;
      attempt.committed = true;
      this.signInEpoch += 1;
      const previous = this.credential;
      await this.storeAccount(next.credential, next.profile);
      return { previous };
    });
    if (outcome === null) {
      await this.revokeUnused(next.credential, "superseded");
      throw new AccountError(
        "superseded",
        "This sign-in was cancelled, or a newer sign-in or sign-out replaced it.",
      );
    }
    const previous = outcome.previous;
    if (previous !== null && previous.serverId !== next.credential.serverId) {
      await this.revokeUnused(previous, "replaced");
    }
  }

  private async revokeUnused(
    credential: StoredCredential,
    reason: "superseded" | "replaced",
  ): Promise<void> {
    if (this.credential?.serverId === credential.serverId) return;
    try {
      await disconnectServer(credential.serverUrl, credential.credential);
      this.options.log.info(
        reason === "replaced"
          ? `revoked the server ${credential.serverId} this bb was signed in to before`
          : `revoked the server credential from a sign-in that didn't finish`,
      );
    } catch (error) {
      this.options.log.warn(
        `couldn't revoke the ${reason === "replaced" ? "previous" : "unused"} server ${credential.serverId} on getbb.app; remove it from ${credential.baseUrl}/dashboard (${errorMessage(error)})`,
      );
    }
  }

  private async confirmRejected(
    credential: StoredCredential,
    context: string,
  ): Promise<void> {
    let me: Awaited<ReturnType<typeof fetchProfile>>;
    try {
      me = await fetchProfile(credential.baseUrl, credential.credential);
    } catch (error) {
      this.options.log.warn(
        `getbb.app answered HTTP 401 on ${context}, and bb couldn't check the credential: ${errorMessage(error)}`,
      );
      return;
    }
    if (me.kind === "unauthorized") {
      await this.rejectCredential(credential.credential, context);
    }
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
