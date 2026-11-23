import { getExperiments, setExperiments } from "@bb/db";
import {
  ACCESS_CREDENTIAL_LABEL_MAX_LENGTH,
  ACCESS_SIGN_IN_THIS_DEVICE_FIRST_ERROR_CODE,
  publicApiRoutes,
  typedRoutes,
  type AccessCredential as AccessCredentialResponse,
  type AccessSessionResponse,
  type PublicApiSchema,
  type SetRequireSignInResponse,
} from "@bb/server-contract";
import type { Context, Hono } from "hono";
import { serialize } from "hono/utils/cookie";
import { ApiError } from "../errors.js";
import {
  accessCookieName,
  getRequestAccess,
  isHttpsRequest,
  requestOrigin,
  requestUrlForDpop,
  type RequestAccess,
  type RequestAccessReader,
} from "../request-access.js";
import {
  getTrustedRemoteAddress,
  type TrustedRemoteAddressReader,
} from "../request-context.js";
import type { AccessCredential } from "../services/access/access-service.js";
import type { ServerAppDeps } from "../types.js";

const ACCESS_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

type AccessRouteDeps = Pick<ServerAppDeps, "access" | "config" | "db" | "hub">;

function currentCredentialId(access: RequestAccess): string | null {
  return access.kind === "owner" && access.via === "credential"
    ? (access.credential.parentId ?? access.credential.id)
    : null;
}

function requestCredential(context: RequestAccessReader): AccessCredential {
  const access = getRequestAccess(context);
  if (access.kind === "owner" && access.via === "credential") {
    return access.credential;
  }
  throw new ApiError(
    401,
    "device_credential_required",
    "Only a signed-in device can do this",
  );
}

function credentialResponse(
  credential: AccessCredential,
  currentId: string | null,
): AccessCredentialResponse {
  return {
    id: credential.id,
    kind: credential.kind,
    label: credential.label,
    origin: credential.origin,
    secureOnly: credential.secureOnly,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
    expiresAt: credential.expiresAt,
    deviceBound: credential.dpopJkt !== null,
    current: credential.id === currentId,
  };
}

function sessionResponse(
  access: RequestAccess,
  requireSignIn: boolean,
): AccessSessionResponse {
  switch (access.kind) {
    case "owner":
      return {
        authenticated: true,
        via: access.via === "in-process" ? "local" : access.via,
        credentialId: currentCredentialId(access),
        problem: null,
        requireSignIn,
      };
    case "machine":
      return {
        authenticated: true,
        via: "machine",
        credentialId: null,
        problem: null,
        requireSignIn,
      };
    case "oauth":
      return {
        authenticated: false,
        via: null,
        credentialId: null,
        problem: null,
        requireSignIn,
      };
    case "anonymous":
      return {
        authenticated: false,
        via: null,
        credentialId: null,
        problem: access.problem,
        requireSignIn,
      };
  }
}

function clearAccessCookie(
  context: Pick<Context, "header">,
  cookieName: string,
): void {
  context.header(
    "set-cookie",
    serialize(cookieName, "", { maxAge: 0, path: "/" }),
    { append: true },
  );
}

function assertOwnerRequest(context: RequestAccessReader): void {
  const access = getRequestAccess(context);
  if (access.kind === "owner") return;
  if (access.kind === "machine") {
    throw new ApiError(
      403,
      "machine_access_management_forbidden",
      "Machine credentials cannot sign devices in or out",
    );
  }
  throw new ApiError(401, "unauthenticated", "Sign in to this bb first");
}

function setAccessCookie(
  context: Pick<Context, "header">,
  cookieName: string,
  token: string,
  secure: boolean,
): void {
  context.header(
    "set-cookie",
    serialize(cookieName, token, {
      httpOnly: true,
      maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "Lax",
      secure,
    }),
    { append: true },
  );
}

type ChangeRequireSignInContext = Pick<Context, "req" | "header"> &
  RequestAccessReader &
  TrustedRemoteAddressReader;

export function changeRequireSignIn(
  context: ChangeRequireSignInContext,
  deps: AccessRouteDeps,
  enabled: boolean,
): SetRequireSignInResponse {
  const access = getRequestAccess(context);
  if (access.kind === "machine") {
    throw new ApiError(
      403,
      "machine_access_management_forbidden",
      "Machine credentials cannot change whether bb requires sign-in",
    );
  }
  if (access.kind !== "owner") {
    throw new ApiError(401, "unauthenticated", "Sign in to this bb first");
  }
  let signedInThisBrowser: AccessCredentialResponse | null = null;
  if (enabled && access.via === "open") {
    if (context.req.header("origin") === undefined) {
      throw new ApiError(
        409,
        ACCESS_SIGN_IN_THIS_DEVICE_FIRST_ERROR_CODE,
        "This device isn't signed in, so requiring sign-in would lock it out. Run `bb access require-sign-in on`, which signs this CLI in first, or sign in with `bb access login --code <code>` and try again.",
      );
    }
    const remoteAddress = getTrustedRemoteAddress(context);
    const secureOnly = isHttpsRequest(context, remoteAddress);
    const issued = deps.access.createBrowserSession({
      label: browserLabel(context.req.header("user-agent")),
      origin: requestOrigin(context, remoteAddress),
      secureOnly,
    });
    setAccessCookie(
      context,
      accessCookieName(deps.config.serverPort),
      issued.token,
      secureOnly,
    );
    signedInThisBrowser = credentialResponse(
      issued.credential,
      issued.credential.id,
    );
  }
  setExperiments(deps.db, { requireSignIn: enabled });
  deps.hub.notifySystem(["config-changed"]);
  return {
    requireSignIn: getExperiments(deps.db).requireSignIn,
    signedInThisBrowser,
  };
}

function browserLabel(userAgent: string | undefined): string {
  if (userAgent === undefined) return "Browser";
  const app = /\bbb-desktop\b|Electron\//u.test(userAgent)
    ? "bb desktop"
    : /Edg\//u.test(userAgent)
      ? "Edge"
      : /Firefox\//u.test(userAgent)
        ? "Firefox"
        : /Chrome\/|CriOS\//u.test(userAgent)
          ? "Chrome"
          : /Safari\//u.test(userAgent)
            ? "Safari"
            : "Browser";
  const platform = /iPhone/u.test(userAgent)
    ? "iPhone"
    : /iPad/u.test(userAgent)
      ? "iPad"
      : /Android/u.test(userAgent)
        ? "Android"
        : /Mac OS X|Macintosh/u.test(userAgent)
          ? "Mac"
          : /Windows/u.test(userAgent)
            ? "Windows"
            : /Linux|X11/u.test(userAgent)
              ? "Linux"
              : null;
  const label = platform === null ? app : `${app} on ${platform}`;
  return label.slice(0, ACCESS_CREDENTIAL_LABEL_MAX_LENGTH);
}

export function registerAccessRoutes(app: Hono, deps: AccessRouteDeps): void {
  const { del, get, post, put } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.access;
  const cookieName = (): string => accessCookieName(deps.config.serverPort);

  get(routes.session, (context) => {
    context.header("cache-control", "no-store");
    return context.json(
      sessionResponse(
        getRequestAccess(context),
        getExperiments(deps.db).requireSignIn,
      ),
    );
  });

  post(routes.createPairing, (context) => {
    assertOwnerRequest(context);
    context.header("cache-control", "no-store");
    return context.json(deps.access.createPairing());
  });

  const setSessionCookie = (
    context: Pick<Context, "header">,
    token: string,
    secure: boolean,
  ): void => setAccessCookie(context, cookieName(), token, secure);

  put(routes.setRequireSignIn, (context, payload) => {
    context.header("cache-control", "no-store");
    return context.json(changeRequireSignIn(context, deps, payload.enabled));
  });

  post(routes.redeemPairing, (context, payload) => {
    context.header("cache-control", "no-store");
    const remoteAddress = getTrustedRemoteAddress(context);
    const secureOnly = isHttpsRequest(context, remoteAddress);
    const common = {
      code: payload.code,
      origin: requestOrigin(context, remoteAddress),
      secureOnly,
    };
    const result = deps.access.redeemPairing(
      payload.kind === "device"
        ? {
            ...common,
            kind: "device",
            label: payload.label,
            proof: {
              method: context.req.method,
              url: requestUrlForDpop(context, remoteAddress),
              proof: context.req.header("dpop"),
            },
          }
        : {
            ...common,
            kind: "browser",
            label: browserLabel(context.req.header("user-agent")),
          },
    );
    switch (result.outcome) {
      case "rate-limited":
        throw new ApiError(
          429,
          "pairing_rate_limited",
          "Too many wrong pairing codes. Wait a few minutes, then try again.",
          { details: { retryAt: result.retryAt }, retryable: true },
        );
      case "invalid":
        throw new ApiError(
          401,
          "invalid_pairing_code",
          "That pairing code is wrong, expired or already used. Make a new one and try again.",
        );
      case "invalid-proof":
        throw new ApiError(
          401,
          "invalid_dpop_proof",
          `A device sign-in needs a valid DPoP proof (${result.failure}).`,
        );
      case "redeemed-device":
        return context.json({
          kind: "device",
          credential: credentialResponse(
            result.credential,
            result.credential.id,
          ),
          accessToken: result.token.accessToken,
          accessTokenExpiresAt: result.token.accessTokenExpiresAt,
        });
      case "redeemed-browser":
        setSessionCookie(context, result.token, secureOnly);
        return context.json({
          kind: "browser",
          credential: credentialResponse(
            result.credential,
            result.credential.id,
          ),
        });
    }
  });

  post(routes.renewToken, (context) => {
    context.header("cache-control", "no-store");
    const authorization = context.req.header("authorization");
    const match =
      authorization === undefined
        ? null
        : /^DPoP\s+(\S+)\s*$/iu.exec(authorization);
    if (match === null) {
      throw new ApiError(
        401,
        "invalid_dpop_proof",
        "Send the device's access token as Authorization: DPoP with a proof from its key.",
      );
    }
    const remoteAddress = getTrustedRemoteAddress(context);
    const result = deps.access.renewDeviceToken(match[1]!, {
      method: context.req.method,
      url: requestUrlForDpop(context, remoteAddress),
      proof: context.req.header("dpop"),
    });
    if (result.outcome === "invalid-proof") {
      throw new ApiError(
        401,
        "invalid_dpop_proof",
        `The renewal proof was rejected (${result.failure}).`,
      );
    }
    if (result.outcome === "invalid") {
      throw new ApiError(
        401,
        "unauthenticated",
        "This device's sign-in was revoked or expired. Pair it again.",
      );
    }
    if (
      result.credential.secureOnly &&
      !isHttpsRequest(context, remoteAddress)
    ) {
      throw new ApiError(
        401,
        "credential_requires_https",
        "This sign-in was made over HTTPS and is not accepted over plain HTTP.",
      );
    }
    return context.json({
      accessToken: result.token.accessToken,
      accessTokenExpiresAt: result.token.accessTokenExpiresAt,
      sessionExpiresAt: result.credential.expiresAt,
    });
  });

  post(routes.createLocalSession, (context, payload) => {
    context.header("cache-control", "no-store");
    const access = getRequestAccess(context);
    if (
      access.kind !== "owner" ||
      (access.via !== "local" && access.via !== "in-process")
    ) {
      throw new ApiError(
        401,
        "local_token_required",
        "Only a process holding the server machine's local token can start a local session",
      );
    }
    const issued = deps.access.createLocalBrowserSession({
      label: payload.label,
      origin: requestOrigin(context, getTrustedRemoteAddress(context)),
    });
    return context.json({
      credential: credentialResponse(issued.credential, issued.credential.id),
      token: issued.token,
      cookieName: cookieName(),
      expiresAt: issued.credential.expiresAt,
    });
  });

  post(routes.createDeviceBrowserSession, (context) => {
    context.header("cache-control", "no-store");
    const device = requestCredential(context);
    if (device.kind !== "device") {
      throw new ApiError(
        403,
        "device_credential_required",
        "Only a device-bound sign-in can mint a short-lived browser session",
      );
    }
    const remoteAddress = getTrustedRemoteAddress(context);
    const issued = deps.access.createDeviceBrowserSession({
      device,
      origin: requestOrigin(context, remoteAddress),
      secureOnly: isHttpsRequest(context, remoteAddress),
    });
    return context.json({
      credential: credentialResponse(issued.credential, device.id),
      token: issued.token,
      cookieName: cookieName(),
      expiresAt: issued.credential.expiresAt,
    });
  });

  post(routes.createWebsocketTicket, (context) => {
    context.header("cache-control", "no-store");
    return context.json(
      deps.access.createWebSocketTicket(requestCredential(context)),
    );
  });

  get(routes.listCredentials, (context) => {
    assertOwnerRequest(context);
    const currentId = currentCredentialId(getRequestAccess(context));
    return context.json({
      credentials: deps.access
        .listCredentials()
        .map((credential) => credentialResponse(credential, currentId)),
    });
  });

  del(routes.revokeCredential, (context) => {
    assertOwnerRequest(context);
    const id = context.req.param("id");
    if (!deps.access.revokeCredential(id)) {
      throw new ApiError(
        404,
        "access_credential_not_found",
        "No signed-in device has that id",
      );
    }
    if (id === currentCredentialId(getRequestAccess(context))) {
      clearAccessCookie(context, cookieName());
    }
    return context.json({ revoked: true });
  });

  post(routes.signOut, (context) => {
    const credentialId = currentCredentialId(getRequestAccess(context));
    clearAccessCookie(context, cookieName());
    return context.json({
      signedOut:
        credentialId !== null && deps.access.revokeCredential(credentialId),
    });
  });
}
