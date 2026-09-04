import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CODEX_AUTH_BASE_URL, CODEX_OAUTH_CLIENT_ID } from "./codex-adapter.js";
import { codexAccessTokenExpiresAt } from "./credentials.js";
import type { AccountSummary } from "./contracts.js";

const LOGIN_SESSION_TTL_MS = 10 * 60 * 1_000;
const DEVICE_CALLBACK_PATH = "/deviceauth/callback";
const CHATGPT_AUTH_CLAIM = "https://api.openai.com/auth";
const CHATGPT_PROFILE_CLAIM = "https://api.openai.com/profile";

const intervalSchema = z.union([
  z.number().int().positive(),
  z
    .string()
    .trim()
    .regex(/^\d+$/u)
    .transform(Number)
    .pipe(z.number().positive()),
]);

const userCodeResponseSchema = z
  .object({
    device_auth_id: z.string().min(1),
    user_code: z.string().min(1),
    interval: intervalSchema,
    expires_at: z.string().datetime({ offset: true }).optional(),
    expires_in: z.number().positive().optional(),
  })
  .passthrough();

const deviceTokenResponseSchema = z
  .object({
    authorization_code: z.string().min(1),
    code_challenge: z.string().min(1),
    code_verifier: z.string().min(1),
  })
  .passthrough();

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    id_token: z.string().min(1),
  })
  .passthrough();

const deviceErrorResponseSchema = z
  .object({
    error: z
      .object({ code: z.string().nullable().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const idTokenPayloadSchema = z
  .object({
    email: z.string().email().optional(),
    chatgpt_account_id: z.string().min(1).optional(),
    [CHATGPT_AUTH_CLAIM]: z
      .object({ chatgpt_account_id: z.string().min(1).optional() })
      .passthrough()
      .optional(),
    [CHATGPT_PROFILE_CLAIM]: z
      .object({ email: z.string().email().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

interface DeviceLoginSession {
  sessionId: string;
  deviceAuthId: string;
  userCode: string;
  intervalMs: number;
  expiresAt: number;
  lastPolledAt: number | null;
  polling: boolean;
}

export interface CodexDeviceAccount {
  label: string;
  email: string | null;
  accountId: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number | null;
}

export interface CodexDeviceLoginOptions {
  fetch?: typeof fetch;
  now?: () => number;
  authBaseUrl?: string;
  addAccount: (authenticated: CodexDeviceAccount) => Promise<AccountSummary>;
}

export interface CodexDeviceLoginStart {
  sessionId: string;
  verificationUri: string;
  userCode: string;
  expiresAt: number;
  intervalMs: number;
}

export type CodexDeviceLoginPoll =
  | { status: "pending" }
  | { status: "complete"; account: AccountSummary }
  | { status: "error"; message: string };

function expiresAt(
  payload: z.infer<typeof userCodeResponseSchema>,
  now: number,
): number {
  const serviceExpiry =
    payload.expires_at === undefined
      ? payload.expires_in === undefined
        ? now + LOGIN_SESSION_TTL_MS
        : now + payload.expires_in * 1_000
      : Date.parse(payload.expires_at);
  if (!Number.isFinite(serviceExpiry)) {
    throw new Error("Codex device login returned an invalid expiry.");
  }
  return Math.min(now + LOGIN_SESSION_TTL_MS, serviceExpiry);
}

function idTokenClaims(idToken: string): {
  accountId: string;
  email: string | null;
} {
  const payloadSegment = idToken.split(".")[1];
  if (payloadSegment === undefined) {
    throw new Error("Codex token exchange returned an invalid ID token.");
  }
  let payload: z.infer<typeof idTokenPayloadSchema>;
  try {
    payload = idTokenPayloadSchema.parse(
      JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")),
    );
  } catch {
    throw new Error("Codex token exchange returned an invalid ID token.");
  }
  const accountId =
    payload[CHATGPT_AUTH_CLAIM]?.chatgpt_account_id ??
    payload.chatgpt_account_id;
  if (accountId === undefined) {
    throw new Error("Codex ID token does not include a ChatGPT account id.");
  }
  return {
    accountId,
    email: payload.email ?? payload[CHATGPT_PROFILE_CLAIM]?.email ?? null,
  };
}

export class CodexDeviceLogin {
  private readonly sessions = new Map<string, DeviceLoginSession>();
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly authBaseUrl: string;

  constructor(private readonly options: CodexDeviceLoginOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.authBaseUrl = (options.authBaseUrl ?? CODEX_AUTH_BASE_URL).replace(
      /\/$/u,
      "",
    );
  }

  async start(): Promise<CodexDeviceLoginStart> {
    const pruneBefore = this.now();
    for (const [sessionId, session] of this.sessions) {
      if (pruneBefore >= session.expiresAt) this.sessions.delete(sessionId);
    }
    const response = await this.fetch(
      `${this.authBaseUrl}/api/accounts/deviceauth/usercode`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID }),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Codex device login could not start (HTTP ${response.status}). Try again.`,
      );
    }
    const payload = await response.json().catch(() => null);
    const parsed = userCodeResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Codex device login returned an invalid response.");
    }
    const now = this.now();
    const session: DeviceLoginSession = {
      sessionId: randomUUID(),
      deviceAuthId: parsed.data.device_auth_id,
      userCode: parsed.data.user_code,
      intervalMs: parsed.data.interval * 1_000,
      expiresAt: expiresAt(parsed.data, now),
      lastPolledAt: null,
      polling: false,
    };
    this.sessions.set(session.sessionId, session);
    return {
      sessionId: session.sessionId,
      verificationUri: `${this.authBaseUrl}/codex/device`,
      userCode: session.userCode,
      expiresAt: session.expiresAt,
      intervalMs: session.intervalMs,
    };
  }

  async poll(input: { sessionId: string }): Promise<CodexDeviceLoginPoll> {
    const session = this.sessions.get(input.sessionId);
    if (session === undefined) {
      return {
        status: "error",
        message: "Login session was not found. Start again.",
      };
    }
    const now = this.now();
    if (now >= session.expiresAt) {
      this.sessions.delete(session.sessionId);
      return { status: "error", message: "Code expired, start again." };
    }
    if (
      session.polling ||
      (session.lastPolledAt !== null &&
        now - session.lastPolledAt < session.intervalMs)
    ) {
      return { status: "pending" };
    }
    session.polling = true;
    session.lastPolledAt = now;
    try {
      const response = await this.fetch(
        `${this.authBaseUrl}/api/accounts/deviceauth/token`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            device_auth_id: session.deviceAuthId,
            user_code: session.userCode,
          }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const parsedError = deviceErrorResponseSchema.safeParse(payload);
        const errorCode = parsedError.success
          ? parsedError.data.error?.code
          : null;
        if (
          response.status === 403 &&
          errorCode === "deviceauth_authorization_pending"
        ) {
          return { status: "pending" };
        }
        if (errorCode?.includes("expired") === true) {
          this.sessions.delete(session.sessionId);
          return { status: "error", message: "Code expired, start again." };
        }
        this.sessions.delete(session.sessionId);
        return {
          status: "error",
          message: `Codex authorization failed (HTTP ${response.status}). Start again.`,
        };
      }
      const payload = await response.json().catch(() => null);
      const parsed = deviceTokenResponseSchema.safeParse(payload);
      if (!parsed.success) {
        this.sessions.delete(session.sessionId);
        return {
          status: "error",
          message:
            "Codex authorization returned an invalid response. Start again.",
        };
      }
      this.sessions.delete(session.sessionId);
      return await this.exchange(parsed.data);
    } catch {
      this.sessions.delete(session.sessionId);
      return {
        status: "error",
        message: "Codex authorization could not be completed. Start again.",
      };
    } finally {
      session.polling = false;
    }
  }

  nextPollDelayMs(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (session === undefined || session.lastPolledAt === null) return 0;
    return Math.max(
      0,
      session.intervalMs - (this.now() - session.lastPolledAt),
    );
  }

  private async exchange(
    authorized: z.infer<typeof deviceTokenResponseSchema>,
  ): Promise<CodexDeviceLoginPoll> {
    const response = await this.fetch(`${this.authBaseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authorized.authorization_code,
        redirect_uri: `${this.authBaseUrl}${DEVICE_CALLBACK_PATH}`,
        client_id: CODEX_OAUTH_CLIENT_ID,
        code_verifier: authorized.code_verifier,
      }).toString(),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        status: "error",
        message: `Codex token exchange failed (HTTP ${response.status}). Start again.`,
      };
    }
    const payload = await response.json().catch(() => null);
    const parsed = tokenResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        status: "error",
        message:
          "Codex token exchange returned an invalid response. Start again.",
      };
    }
    try {
      const claims = idTokenClaims(parsed.data.id_token);
      const account = await this.options.addAccount({
        label: claims.email ?? "Codex account",
        email: claims.email,
        accountId: claims.accountId,
        accessToken: parsed.data.access_token,
        refreshToken: parsed.data.refresh_token,
        idToken: parsed.data.id_token,
        expiresAt: codexAccessTokenExpiresAt(parsed.data.access_token),
      });
      return { status: "complete", account };
    } catch (error) {
      return {
        status: "error",
        message:
          error instanceof Error && error.message.startsWith("Codex ")
            ? `${error.message} Start again.`
            : "Codex account could not be saved. Start again.",
      };
    }
  }
}
