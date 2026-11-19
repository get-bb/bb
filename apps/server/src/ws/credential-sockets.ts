import type { Context } from "hono";
import type { WSContext } from "hono/ws";
import { getRequestAccess } from "../request-access.js";
import type { AccessService } from "../services/access/access-service.js";

const CREDENTIAL_REVOKED_CLOSE_CODE = 4401;

interface CredentialSocket {
  opened(socket: WSContext): void;
  closed(): void;
}

export function trackCredentialSocket(
  access: Pick<AccessService, "trackSocket">,
  context: Context,
): CredentialSocket {
  const requestAccess = getRequestAccess(context);
  if (requestAccess.kind !== "owner" || requestAccess.via !== "credential") {
    return { opened: () => {}, closed: () => {} };
  }
  let untrack: (() => void) | null = null;
  return {
    opened(socket) {
      untrack = access.trackSocket(requestAccess.credential.id, () =>
        socket.close(CREDENTIAL_REVOKED_CLOSE_CODE, "credential revoked"),
      );
    },
    closed() {
      untrack?.();
      untrack = null;
    },
  };
}
