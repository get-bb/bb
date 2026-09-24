import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { AccountError, type AccountService } from "./account.js";
import { normalizeOrigin, type BaseUrlAllowed } from "./base-url.js";
import {
  ADOPT_CONNECT_CREDENTIAL_METHOD,
  FETCH_METHOD,
  STATUS_METHOD,
  WAIT_FOR_STATUS_CHANGE_METHOD,
  accountPrivateRpcContract,
  accountRpcContract,
} from "./contract.js";
import { isConnectPlugin } from "./fetch-path.js";
import { HostedRequestError, RedeemError } from "./hosted.js";
import type { LinkLogins } from "./login.js";

export interface BaseUrlPolicy {
  defaultBaseUrl: string;
  allowed: BaseUrlAllowed;
}

export function resolveBaseUrl(
  override: string | null,
  policy: BaseUrlPolicy,
): string {
  if (override === null) return policy.defaultBaseUrl;
  const origin = normalizeOrigin(override, "baseUrl");
  if (!policy.allowed(origin)) {
    throw new Error(
      `bb can't sign in to ${origin}; use https://getbb.app or https://vibecodethis.site (a development build also accepts http://bb.localhost:<port>)`,
    );
  }
  return origin;
}

export function toCodedError(error: unknown): Error {
  if (error instanceof RedeemError || error instanceof AccountError) {
    return new Error(error.code);
  }
  if (error instanceof HostedRequestError) return new Error(error.code);
  return error instanceof Error ? error : new Error(String(error));
}

async function rethrowCoded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toCodedError(error);
  }
}

export function registerAccountRpc(args: {
  bb: Pick<BbPluginApi, "rpc">;
  account: AccountService;
  logins: LinkLogins;
  baseUrls: BaseUrlPolicy;
}): void {
  const { bb, account, logins, baseUrls } = args;
  bb.rpc.register(
    accountRpcContract,
    {
      [STATUS_METHOD]: () => account.status(),
      [WAIT_FOR_STATUS_CHANGE_METHOD]: (input) =>
        account.waitForStatusChange(input.afterRevision),
      [FETCH_METHOD]: (input, context) =>
        account.fetch(input, context.experimental_caller),
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Sign-in state for this bb's getbb.app account, and authenticated requests to getbb.app made as this server.",
    },
  );
  bb.rpc.register(accountPrivateRpcContract, {
    [ADOPT_CONNECT_CREDENTIAL_METHOD]: (input, context) => {
      if (!isConnectPlugin(context.experimental_caller)) {
        throw new Error("only the connect plugin can hand over its pairing");
      }
      return account.adoptConnectCredential(input);
    },
    "login.start": (input) =>
      rethrowCoded(() => logins.start(resolveBaseUrl(input.baseUrl, baseUrls))),
    "login.poll": (input) => ({
      login: logins.view(input.loginId),
      status: account.status(),
    }),
    "login.cancel": (input) => ({ login: logins.cancel(input.loginId) }),
    redeemCode: (input) =>
      rethrowCoded(() =>
        logins.redeemCode(input.code, resolveBaseUrl(input.baseUrl, baseUrls)),
      ),
    signOut: () => logins.signOut(),
  });
}
