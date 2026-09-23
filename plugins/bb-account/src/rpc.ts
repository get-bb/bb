import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { AccountError, type AccountService } from "./account.js";
import { normalizeOrigin } from "./base-url.js";
import {
  ADOPT_CONNECT_CREDENTIAL_METHOD,
  FETCH_METHOD,
  STATUS_METHOD,
  WAIT_FOR_STATUS_CHANGE_METHOD,
  accountPrivateRpcContract,
  accountRpcContract,
} from "./contract.js";
import { HostedRequestError, RedeemError } from "./hosted.js";
import type { LinkLogins } from "./login.js";

export function resolveBaseUrl(
  override: string | null,
  defaultBaseUrl: string,
): string {
  return override === null
    ? defaultBaseUrl
    : normalizeOrigin(override, "baseUrl");
}

export function toCodedError(error: unknown): Error {
  if (error instanceof RedeemError || error instanceof AccountError) {
    return new Error(error.code);
  }
  if (error instanceof HostedRequestError) return new Error("network");
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
  defaultBaseUrl: string;
}): void {
  const { bb, account, logins, defaultBaseUrl } = args;
  bb.rpc.register(
    accountRpcContract,
    {
      [STATUS_METHOD]: () => account.status(),
      [WAIT_FOR_STATUS_CHANGE_METHOD]: (input) =>
        account.waitForStatusChange(input.afterRevision),
      [FETCH_METHOD]: (input) => account.fetch(input),
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Sign-in state for this bb's getbb.app account, and authenticated requests to getbb.app made as this server.",
    },
  );
  bb.rpc.register(accountPrivateRpcContract, {
    [ADOPT_CONNECT_CREDENTIAL_METHOD]: (input) =>
      account.adoptConnectCredential(input),
    "login.start": (input) =>
      rethrowCoded(() =>
        logins.start(resolveBaseUrl(input.baseUrl, defaultBaseUrl)),
      ),
    "login.poll": (input) => ({
      login: logins.view(input.loginId),
      status: account.status(),
    }),
    "login.cancel": (input) => ({ login: logins.cancel(input.loginId) }),
    redeemCode: (input) =>
      rethrowCoded(() =>
        account.redeemCode(
          input.code,
          resolveBaseUrl(input.baseUrl, defaultBaseUrl),
        ),
      ),
    signOut: () => account.signOut(),
  });
}
