import type { ClientRequest, IncomingMessage } from "node:http";
import type { HttpProxy } from "vite";
import { isLoopbackAddress, isLoopbackHostname } from "@bb/config/loopback";

const FORWARDING_HEADERS = [
  "forwarded",
  "via",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-real-ip",
  "cf-connecting-ip",
  "cf-ray",
];

function hostnameOf(host: string | undefined): string | null {
  if (host === undefined) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

export function isLocalLadleRequest(request: IncomingMessage): boolean {
  const peer = request.socket.remoteAddress ?? "";
  const peerAddress = peer.startsWith("::ffff:") ? peer.slice(7) : peer;
  if (!isLoopbackAddress(peerAddress)) return false;
  const hostname = hostnameOf(request.headers.host);
  if (hostname === null || !isLoopbackHostname(hostname)) return false;
  return !Object.keys(request.headers).some(
    (name) =>
      FORWARDING_HEADERS.includes(name) || name.startsWith("tailscale-"),
  );
}

export function signInLocalLadleRequests(
  readToken: () => string | null,
): (proxy: HttpProxy.Server) => void {
  return (proxy) => {
    const authorize = (
      proxyRequest: ClientRequest,
      request: IncomingMessage,
    ): void => {
      proxyRequest.removeHeader("authorization");
      if (!isLocalLadleRequest(request)) return;
      const token = readToken();
      if (token !== null) {
        proxyRequest.setHeader("authorization", `Bearer ${token}`);
      }
    };
    proxy.on("proxyReq", authorize);
    proxy.on("proxyReqWs", authorize);
  };
}
