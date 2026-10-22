export interface FakeRpcArgs {
  pluginId: string;
  method: string;
  input?: unknown;
  outputSchema: { parse(value: unknown): unknown };
  signal?: AbortSignal;
}

interface FakeAccountState {
  state: string;
  revision: number;
  account: {
    serverId: string;
    serverLabel: string;
    serverUrl: string;
    baseUrl: string;
    userId: string;
    githubLogin: string | null;
    name: string;
    avatarUrl: string | null;
    handle: string | null;
  } | null;
}

export class FakeAccount {
  available = true;
  credential: string | null = null;
  private current: FakeAccountState = {
    state: "signed-out",
    revision: 1,
    account: null,
  };
  private readonly waiters = new Set<() => void>();

  signIn(input: {
    serverId: string;
    label: string;
    credential: string;
    baseUrl?: string;
  }) {
    const baseUrl = input.baseUrl ?? "https://getbb.app";
    this.credential = input.credential;
    this.current = {
      state: "signed-in",
      revision: this.current.revision + 1,
      account: {
        serverId: input.serverId,
        serverLabel: input.label,
        serverUrl: `${new URL(baseUrl).protocol}//${input.label}.${new URL(baseUrl).host}`,
        baseUrl,
        userId: "usr_1",
        githubLogin: "sawyer",
        name: "Sawyer",
        avatarUrl: null,
        handle: input.label,
      },
    };
    this.wake();
  }

  signOut(): void {
    this.credential = null;
    this.current = {
      state: "signed-out",
      revision: this.current.revision + 1,
      account: null,
    };
    this.wake();
  }

  readonly callRpc = async (args: FakeRpcArgs): Promise<unknown> => {
    if (args.pluginId !== "bb-account" || !this.available) {
      throw Object.assign(new Error("HTTP 503: bb-account is not running"), {
        status: 503,
      });
    }
    return args.outputSchema.parse(await this.handle(args));
  };

  private wake(): void {
    for (const waiter of [...this.waiters]) waiter();
  }

  private handle(args: FakeRpcArgs): Promise<unknown> | unknown {
    switch (args.method) {
      case "bb-account.v1.status":
        return this.current;
      case "bb-account.v1.waitForStatusChange": {
        const { afterRevision } = args.input as { afterRevision: number };
        return this.waitForChange(afterRevision, args.signal);
      }
      case "bb-account.v1.connectCredential": {
        const account = this.current.account;
        return {
          credential:
            account === null || this.credential === null
              ? null
              : {
                  baseUrl: account.baseUrl,
                  serverUrl: account.serverUrl,
                  serverId: account.serverId,
                  credential: this.credential,
                },
        };
      }
    }
    throw new Error(`unknown bb-account method ${args.method}`);
  }

  private waitForChange(
    afterRevision: number,
    signal: AbortSignal | undefined,
  ): Promise<FakeAccountState> {
    if (this.current.revision > afterRevision) {
      return Promise.resolve(this.current);
    }
    return new Promise((resolve, reject) => {
      const finish = () => {
        this.waiters.delete(finish);
        signal?.removeEventListener("abort", abort);
        resolve(this.current);
      };
      const abort = () => {
        this.waiters.delete(finish);
        reject(signal?.reason ?? new Error("aborted"));
      };
      this.waiters.add(finish);
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}
