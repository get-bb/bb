import {
  ACCESS_CREDENTIAL_LABEL_MAX_LENGTH,
  publicApiRoutes,
  typedRoutes,
  type AccessCredential as AccessCredentialResponse,
  type AccessSessionResponse,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Context, Hono } from "hono";
import { serialize } from "hono/utils/cookie";
import { ApiError } from "../errors.js";
import {
  accessCookieName,
  getRequestAccess,
  isHttpsRequest,
  requestOrigin,
  type RequestAccess,
  type RequestAccessReader,
} from "../request-access.js";
import { getTrustedRemoteAddress } from "../request-context.js";
import type { AccessCredential } from "../services/access/access-service.js";
import type { ServerAppDeps } from "../types.js";

const ACCESS_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

type AccessRouteDeps = Pick<ServerAppDeps, "access" | "config">;

function currentCredentialId(access: RequestAccess): string | null {
  return access.kind === "owner" && access.via === "credential"
    ? access.credential.id
    : null;
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
    current: credential.id === currentId,
  };
}

function sessionResponse(access: RequestAccess): AccessSessionResponse {
  switch (access.kind) {
    case "owner":
      return {
        authenticated: true,
        via: access.via,
        credentialId: currentCredentialId(access),
        problem: null,
      };
    case "machine":
      return {
        authenticated: true,
        via: "machine",
        credentialId: null,
        problem: null,
      };
    case "oauth":
      return {
        authenticated: false,
        via: null,
        credentialId: null,
        problem: null,
      };
    case "anonymous":
      return {
        authenticated: false,
        via: null,
        credentialId: null,
        problem: access.problem,
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
  const { del, get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.access;
  const cookieName = (): string => accessCookieName(deps.config.serverPort);

  get(routes.session, (context) => {
    context.header("cache-control", "no-store");
    return context.json(sessionResponse(getRequestAccess(context)));
  });

  post(routes.createPairing, (context) => {
    assertOwnerRequest(context);
    context.header("cache-control", "no-store");
    return context.json(deps.access.createPairing());
  });

  post(routes.redeemPairing, (context, payload) => {
    context.header("cache-control", "no-store");
    const remoteAddress = getTrustedRemoteAddress(context);
    const secureOnly = isHttpsRequest(context, remoteAddress);
    const result = deps.access.redeemPairing({
      code: payload.code,
      kind: payload.kind,
      label:
        payload.kind === "device"
          ? payload.label
          : browserLabel(context.req.header("user-agent")),
      origin: requestOrigin(context, remoteAddress),
      secureOnly,
    });
    if (result.outcome === "rate-limited") {
      throw new ApiError(
        429,
        "pairing_rate_limited",
        "Too many wrong pairing codes. Wait a few minutes, then try again.",
        { details: { retryAt: result.retryAt }, retryable: true },
      );
    }
    if (result.outcome === "invalid") {
      throw new ApiError(
        401,
        "invalid_pairing_code",
        "That pairing code is wrong, expired or already used. Make a new one and try again.",
      );
    }
    const credential = credentialResponse(
      result.credential,
      result.credential.id,
    );
    if (payload.kind === "device") {
      return context.json({
        kind: "device",
        credential,
        token: result.token,
        cookieName: cookieName(),
      });
    }
    context.header(
      "set-cookie",
      serialize(cookieName(), result.token, {
        httpOnly: true,
        maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
        path: "/",
        sameSite: "Lax",
        secure: secureOnly,
      }),
      { append: true },
    );
    return context.json({ kind: "browser", credential });
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
