import type {
  Account,
  AccountFetchRequest,
  AccountFetchResult,
  AccountStatus,
  AdoptResult,
} from "../account-client.js";

export interface AdoptRequest {
  credential: string;
  baseUrl: string;
  replaces: string | null;
}

type FetchRoute = (
  request: AccountFetchRequest,
) => AccountFetchResult | Promise<AccountFetchResult>;

export interface FakeRpcArgs {
  pluginId: string;
  method: string;
  input?: unknown;
  outputSchema: { parse(value: unknown): unknown };
  signal?: AbortSignal;
}

export const TEST_ACCOUNT: Account = {
  userId: "usr_1",
  githubLogin: "sawyerhood",
  name: "Sawyer Hood",
  avatarUrl: null,
  handle: "sawyer",
  serverId: "srv_1",
  serverLabel: "sawyer",
  serverUrl: "https://sawyer.getbb.app",
  baseUrl: "https://getbb.app",
};

export class FakeAccount {
  available = true;
  readonly fetches: AccountFetchRequest[] = [];
  readonly adoptions: unknown[] = [];
  readonly redemptions: unknown[] = [];
  serverCredential: string | null = null;
  credentialReads = 0;
  readonly refusedCredentials: string[] = [];
  adopt: (input: AdoptRequest) => AdoptResult = () => "rejected";
  redeem: (input: { code: string; baseUrl: string | null }) => Account = () => {
    throw new Error("invalid_code");
  };
  private current: AccountStatus = {
    state: "signed-out",
    revision: 1,
    account: null,
  };
  private readonly routes = new Map<string, FetchRoute>();
  private readonly waiters = new Set<() => void>();

  get status(): AccountStatus {
    return this.current;
  }

  signIn(overrides: Partial<Account> = {}): Account {
    const account = { ...TEST_ACCOUNT, ...overrides };
    this.current = {
      state: "signed-in",
      revision: this.current.revision + 1,
      account,
    };
    this.wake();
    return account;
  }

  signOut(): void {
    this.current = {
      state: "signed-out",
      revision: this.current.revision + 1,
      account: null,
    };
    this.wake();
  }

  route(
    target: AccountFetchRequest["target"],
    method: AccountFetchRequest["method"],
    path: string,
    handler: FetchRoute,
  ): void {
    this.routes.set(`${target} ${method} ${path}`, handler);
  }

  readonly callRpc = async (args: FakeRpcArgs): Promise<unknown> => {
    if (args.pluginId !== "bb-account" || !this.available) {
      throw Object.assign(
        new Error(`HTTP 503: plugin "${args.pluginId}" is not running`),
        { status: 503 },
      );
    }
    return args.outputSchema.parse(
      await this.handle(args.method, args.input, args.signal),
    );
  };

  private wake(): void {
    for (const waiter of [...this.waiters]) waiter();
  }

  private waitForChange(
    afterRevision: number,
    signal: AbortSignal | undefined,
  ): Promise<AccountStatus> {
    if (this.current.revision > afterRevision) {
      return Promise.resolve(this.current);
    }
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.waiters.delete(finish);
        signal?.removeEventListener("abort", abort);
        resolve(this.current);
      };
      const abort = () => {
        clearTimeout(timer);
        this.waiters.delete(finish);
        reject(signal?.reason ?? new Error("aborted"));
      };
      const timer = setTimeout(finish, 25_000);
      timer.unref?.();
      this.waiters.add(finish);
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  private async handle(
    method: string,
    input: unknown,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    switch (method) {
      case "bb-account.v1.status":
        return this.current;
      case "bb-account.v1.waitForStatusChange":
        return this.waitForChange(
          (input as { afterRevision: number }).afterRevision,
          signal,
        );
      case "bb-account.v1.fetch": {
        const request = input as AccountFetchRequest;
        this.fetches.push(request);
        if (this.current.state !== "signed-in") {
          return { status: 401, body: { error: "signed-out" } };
        }
        const route = this.routes.get(
          `${request.target} ${request.method} ${request.path}`,
        );
        if (route === undefined) {
          return { status: 404, body: { error: "not-found" } };
        }
        return route(request);
      }
      case "bb-account.v1.adoptConnectCredential": {
        const request = input as AdoptRequest;
        this.adoptions.push(request);
        const result = this.adopt(request);
        if (result === "adopted") {
          this.serverCredential = request.credential;
          this.signIn();
        }
        return { result };
      }
      case "bb-account.v1.connectCredential": {
        this.credentialReads += 1;
        const account = this.current.account;
        return {
          credential:
            account === null || this.serverCredential === null
              ? null
              : {
                  baseUrl: account.baseUrl,
                  serverUrl: account.serverUrl,
                  serverId: account.serverId,
                  credential: this.serverCredential,
                },
        };
      }
      case "bb-account.v1.confirmRefusedCredential": {
        this.refusedCredentials.push((input as { credential: string }).credential);
        return this.current;
      }
      case "redeemCode": {
        this.redemptions.push(input);
        const account = this.redeem(
          input as { code: string; baseUrl: string | null },
        );
        this.signIn(account);
        return this.current;
      }
    }
    throw new Error(`unknown bb-account method ${method}`);
  }
}
