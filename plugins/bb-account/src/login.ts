import { randomUUID } from "node:crypto";
import type { PluginLogger } from "@get-bb/plugin-sdk";
import { serverUrlForHandle } from "@bb/connect-client";
import { AccountError, type AccountService } from "./account.js";
import type { LoginState, LoginView } from "./contract.js";
import { pollLink, startLink } from "./hosted.js";

const REUSE_MIN_REMAINING_MS = 60_000;

export interface LinkPollTiming {
  minIntervalMs: number;
  maxIntervalMs: number;
  slowDownStepMs: number;
  marginMs: number;
}

export const DEFAULT_LINK_POLL_TIMING: LinkPollTiming = {
  minIntervalMs: 1_000,
  maxIntervalMs: 30_000,
  slowDownStepMs: 5_000,
  marginMs: 250,
};

interface PendingLogin {
  view: LoginView;
  baseUrl: string;
  deviceCode: string;
  intervalMs: number;
  controller: AbortController;
  settled: Promise<LoginView>;
  settle(view: LoginView): void;
}

interface LinkLoginsOptions {
  account: AccountService;
  clientName: string;
  log: PluginLogger;
  timing: LinkPollTiming;
  onChange(view: LoginView): void;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LinkLogins {
  private current: PendingLogin | null = null;

  constructor(private readonly options: LinkLoginsOptions) {}

  async start(baseUrl: string): Promise<LoginView> {
    const existing = this.current;
    if (
      existing !== null &&
      existing.view.state === "pending" &&
      existing.baseUrl === baseUrl &&
      existing.view.expiresAt - Date.now() > REUSE_MIN_REMAINING_MS
    ) {
      return existing.view;
    }
    const started = await startLink(baseUrl, this.options.clientName);
    if (existing !== null && existing.view.state === "pending") {
      this.finish(existing, "cancelled", "A newer sign-in replaced this one.");
    }
    let settle!: (view: LoginView) => void;
    const settled = new Promise<LoginView>((resolve) => {
      settle = resolve;
    });
    const login: PendingLogin = {
      view: {
        id: randomUUID(),
        state: "pending",
        userCode: started.userCode,
        verificationUrl: started.verificationUrl,
        expiresAt: started.expiresAt,
        message: null,
      },
      baseUrl,
      deviceCode: started.deviceCode,
      intervalMs: Math.max(
        started.intervalMs,
        this.options.timing.minIntervalMs,
      ),
      controller: new AbortController(),
      settled,
      settle,
    };
    this.current = login;
    this.options.onChange(login.view);
    void this.poll(login);
    return login.view;
  }

  view(loginId: string | null): LoginView | null {
    const current = this.current;
    if (current === null) return null;
    if (loginId !== null && current.view.id !== loginId) return null;
    return current.view;
  }

  cancel(loginId: string): LoginView | null {
    const current = this.current;
    if (current === null || current.view.id !== loginId) return null;
    if (current.view.state === "pending") {
      this.finish(current, "cancelled", "Sign-in was cancelled.");
    }
    return current.view;
  }

  async wait(signal: AbortSignal | undefined): Promise<LoginView | null> {
    const current = this.current;
    if (current === null) return null;
    if (current.view.state !== "pending") return current.view;
    if (signal === undefined) return current.settled;
    return Promise.race([
      current.settled,
      new Promise<LoginView>((resolve) => {
        if (signal.aborted) resolve(current.view);
        signal.addEventListener("abort", () => resolve(current.view), {
          once: true,
        });
      }),
    ]);
  }

  dispose(): void {
    const current = this.current;
    if (current !== null && current.view.state === "pending") {
      this.finish(current, "cancelled", "bb account stopped.");
    }
  }

  private finish(
    login: PendingLogin,
    state: Exclude<LoginState, "pending">,
    message: string | null,
  ): void {
    if (login.view.state !== "pending") return;
    login.controller.abort();
    login.view = { ...login.view, state, message };
    login.settle(login.view);
    if (this.current === login) this.options.onChange(login.view);
  }

  private async poll(login: PendingLogin): Promise<void> {
    const signal = login.controller.signal;
    const timing = this.options.timing;
    let interval = login.intervalMs;
    while (login.view.state === "pending") {
      await sleep(interval + timing.marginMs, signal);
      if (signal.aborted || login.view.state !== "pending") return;
      if (Date.now() >= login.view.expiresAt) {
        this.finish(login, "expired", "The sign-in code expired.");
        return;
      }
      let result: Awaited<ReturnType<typeof pollLink>>;
      try {
        result = await pollLink(login.baseUrl, login.deviceCode);
      } catch (error) {
        this.options.log.warn(
          `waiting for sign-in approval: ${errorMessage(error)}`,
        );
        continue;
      }
      if (signal.aborted || login.view.state !== "pending") return;
      switch (result.kind) {
        case "pending":
          continue;
        case "slow-down":
          interval = Math.min(
            interval + timing.slowDownStepMs,
            timing.maxIntervalMs,
          );
          continue;
        case "denied":
          this.finish(login, "denied", "Sign-in was denied on getbb.app.");
          return;
        case "expired":
          this.finish(login, "expired", "The sign-in code expired.");
          return;
        case "invalid":
          this.finish(
            login,
            "failed",
            "getbb.app no longer knows this sign-in.",
          );
          return;
        case "already-used":
          this.finish(login, "failed", "This sign-in was already completed.");
          return;
        case "approved":
          await this.complete(login, result);
          return;
      }
    }
  }

  private async complete(
    login: PendingLogin,
    approved: {
      credential: string;
      serverId: string;
      handle: string | null;
      serverUrl: string | null;
    },
  ): Promise<void> {
    try {
      await this.options.account.completeSignIn({
        baseUrl: login.baseUrl,
        credential: approved.credential,
        serverId: approved.serverId,
        serverUrl:
          approved.serverUrl ??
          (approved.handle === null
            ? null
            : serverUrlForHandle(login.baseUrl, approved.handle)),
      });
      this.finish(login, "signed-in", null);
    } catch (error) {
      const message =
        error instanceof AccountError ? error.message : errorMessage(error);
      this.options.log.warn(`sign-in could not finish: ${message}`);
      this.finish(login, "failed", message);
    }
  }
}
