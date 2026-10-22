import type { TunnelServer } from "@bb/frp-client";

export interface NextSite {
  domain: string;
  origin(label: string): string;
  tunnelServer: TunnelServer;
}

export function nextSiteForAccount(baseUrl: string): NextSite {
  const account = new URL(baseUrl);
  const secure = account.protocol === "https:";
  const domain = `next.${account.host}`;
  return {
    domain,
    origin: (label) => `${account.protocol}//${label}.${domain}`,
    tunnelServer: {
      protocol: secure ? "wss" : "websocket",
      host: `tunnel.next.${account.hostname}`,
      port: account.port === "" ? (secure ? 443 : 80) : Number(account.port),
    },
  };
}
