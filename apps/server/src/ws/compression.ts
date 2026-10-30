import { IncomingMessage } from "node:http";
import { constants } from "node:zlib";
import type { Context } from "hono";
import type { PerMessageDeflateOptions } from "ws";

export const WEB_SOCKET_COMPRESSION: PerMessageDeflateOptions = {
  threshold: 1024,
  zlibDeflateOptions: { level: constants.Z_BEST_SPEED },
};

export const COMPRESSED_SEND = { compress: true } as const;

export function declineWebSocketCompression(context: Context): void {
  const env: unknown = context.env;
  if (
    typeof env !== "object" ||
    env === null ||
    !("incoming" in env) ||
    !(env.incoming instanceof IncomingMessage)
  ) {
    return;
  }
  delete env.incoming.headers["sec-websocket-extensions"];
}
