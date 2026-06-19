import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";

/**
 * "AirDrop for threads" routes. Only registered when a PeerShareService is
 * present on deps (production); absent in tests that don't wire it.
 */
export function registerPeerShareRoutes(app: Hono, deps: AppDeps): void {
  const peerShare = deps.peerShare;
  if (!peerShare) {
    return;
  }

  const { get, post, put } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.peerShare;

  get(routes.identity, (context) => context.json(peerShare.getIdentity()));

  put(routes.updateIdentity, (context, payload) =>
    context.json(peerShare.setIdentity(payload)),
  );

  get(routes.peers, (context) =>
    context.json({ peers: peerShare.listPeers() }),
  );

  post(routes.send, async (context, payload) => {
    try {
      await peerShare.sendThread({
        threadId: payload.threadId,
        address: payload.address,
        port: payload.port,
      });
    } catch (error) {
      throw new ApiError(
        502,
        "peer_unreachable",
        error instanceof Error ? error.message : "Failed to reach peer",
      );
    }
    return context.json({ ok: true } as const);
  });

  post(routes.offer, (context, payload) => {
    peerShare.receiveOffer({
      senderName: payload.senderName,
      bundle: payload.bundle,
    });
    return context.json({ ok: true } as const);
  });

  get(routes.incoming, (context) =>
    context.json({ shares: peerShare.listIncoming() }),
  );

  post(routes.accept, (context) => {
    try {
      return context.json(peerShare.acceptIncoming(context.req.param("id")));
    } catch (error) {
      throw new ApiError(
        404,
        "not_found",
        error instanceof Error ? error.message : "Share not found",
      );
    }
  });

  post(routes.decline, (context) => {
    peerShare.declineIncoming(context.req.param("id"));
    return context.json({ ok: true } as const);
  });
}
