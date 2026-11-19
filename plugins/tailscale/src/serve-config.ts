import { z } from "zod";

export const TAILSCALE_ADMIN_DNS_URL = "https://login.tailscale.com/admin/dns";

const nodeStatusSchema = z.object({
  Version: z.string().optional(),
  BackendState: z.string(),
  MagicDNSSuffix: z.string().optional(),
  CertDomains: z.array(z.string()).nullish(),
  Self: z
    .object({
      DNSName: z.string().optional(),
      TailscaleIPs: z.array(z.string()).nullish(),
      HostName: z.string().optional(),
    })
    .nullish(),
  CurrentTailnet: z
    .object({
      MagicDNSSuffix: z.string().optional(),
      MagicDNSEnabled: z.boolean().optional(),
    })
    .nullish(),
});

export interface TailscaleNode {
  version: string | null;
  backendState: string;
  dnsName: string | null;
  tailnet: string | null;
  magicDns: boolean;
  https: boolean;
  addresses: string[];
}

function withoutTrailingDot(name: string): string {
  return name.endsWith(".") ? name.slice(0, -1) : name;
}

export function parseNodeStatus(stdout: string): TailscaleNode {
  const raw = nodeStatusSchema.parse(JSON.parse(stdout));
  const dnsName = withoutTrailingDot(raw.Self?.DNSName ?? "");
  const tailnet =
    raw.CurrentTailnet?.MagicDNSSuffix || raw.MagicDNSSuffix || null;
  return {
    version: raw.Version?.split("-")[0] ?? null,
    backendState: raw.BackendState,
    dnsName: dnsName === "" ? null : dnsName,
    tailnet,
    magicDns: raw.CurrentTailnet?.MagicDNSEnabled ?? dnsName !== "",
    https:
      dnsName !== "" &&
      (raw.CertDomains ?? []).some(
        (domain) => withoutTrailingDot(domain) === dnsName,
      ),
    addresses: raw.Self?.TailscaleIPs ?? [],
  };
}

const serveConfigSchema = z.object({
  TCP: z
    .record(
      z.string(),
      z.object({
        HTTPS: z.boolean().optional(),
        HTTP: z.boolean().optional(),
        TCPForward: z.string().optional(),
      }),
    )
    .nullish(),
  Web: z
    .record(
      z.string(),
      z.object({
        Handlers: z
          .record(z.string(), z.object({ Proxy: z.string().optional() }))
          .nullish(),
      }),
    )
    .nullish(),
  AllowFunnel: z.record(z.string(), z.boolean()).nullish(),
  Foreground: z
    .record(
      z.string(),
      z.object({ TCP: z.record(z.string(), z.unknown()).nullish() }),
    )
    .nullish(),
});

export interface ServeConfig {
  ports: ReadonlySet<number>;
  rootProxy(dnsName: string, port: number): string | null;
  https(port: number): boolean;
  funnel(dnsName: string, port: number): boolean;
}

export function parseServeConfig(stdout: string): ServeConfig {
  const text = stdout.trim();
  const raw = serveConfigSchema.parse(text === "" ? {} : JSON.parse(text));
  const tcp = raw.TCP ?? {};
  const foregroundPorts = Object.values(raw.Foreground ?? {}).flatMap(
    (session) => Object.keys(session.TCP ?? {}),
  );
  const ports = new Set(
    [...Object.keys(tcp), ...foregroundPorts]
      .map(Number)
      .filter((port) => Number.isInteger(port)),
  );
  return {
    ports,
    rootProxy: (dnsName, port) =>
      raw.Web?.[`${dnsName}:${port}`]?.Handlers?.["/"]?.Proxy ?? null,
    https: (port) => tcp[String(port)]?.HTTPS === true,
    funnel: (dnsName, port) => raw.AllowFunnel?.[`${dnsName}:${port}`] === true,
  };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function proxiesTo(proxy: string, target: string): boolean {
  let from: URL;
  let to: URL;
  try {
    from = new URL(proxy.includes("://") ? proxy : `http://${proxy}`);
    to = new URL(target);
  } catch {
    return false;
  }
  return (
    from.protocol === "http:" &&
    LOOPBACK_HOSTS.has(from.hostname) &&
    from.port === to.port &&
    (from.pathname === "/" || from.pathname === "")
  );
}

export function servePortCandidates(target: string): number[] {
  const bbPort = Number(new URL(target).port);
  return [...new Set([443, bbPort])];
}

export function findBbMapping(
  config: ServeConfig,
  dnsName: string,
  target: string,
): { port: number; funnel: boolean } | null {
  const ports = [...config.ports].sort((a, b) =>
    a === 443 ? -1 : b === 443 ? 1 : a - b,
  );
  for (const port of ports) {
    if (!config.https(port)) continue;
    const proxy = config.rootProxy(dnsName, port);
    if (proxy !== null && proxiesTo(proxy, target)) {
      return { port, funnel: config.funnel(dnsName, port) };
    }
  }
  return null;
}

export function freeServePorts(config: ServeConfig, target: string): number[] {
  return servePortCandidates(target).filter((port) => !config.ports.has(port));
}

export function serveUrl(dnsName: string, port: number): string {
  return port === 443 ? `https://${dnsName}` : `https://${dnsName}:${port}`;
}
