import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { dnsName } from "./schemas.js";

const peerSchema = z.object({
  ID: z.string().min(1).max(200),
  HostName: z.string().max(255),
  DNSName: dnsName,
  OS: z.string().max(50),
  Online: z.boolean(),
  Expired: z.boolean().optional().default(false),
  TailscaleIPs: z.array(z.string().refine((s) => isIP(s) !== 0)).max(16),
});
const statusSchema = z.object({
  BackendState: z.string(),
  Self: peerSchema,
  CertDomains: z
    .array(dnsName)
    .max(1000)
    .nullish()
    .transform((domains) => domains ?? []),
  Peer: z.record(z.string(), peerSchema).default({}),
});
export function parseStatus(raw: string) {
  const status = statusSchema.parse(JSON.parse(raw));
  if (status.BackendState !== "Running" || !status.Self.Online)
    throw new Error("Sign in to Tailscale on the bb server machine.");
  const devices = Object.values(status.Peer)
    .filter(
      (p) =>
        p.ID !== status.Self.ID &&
        !p.Expired &&
        ["macOS", "linux"].includes(p.OS),
    )
    .map((p) => ({
      id: p.ID,
      label: p.HostName,
      dnsName: p.DNSName,
      os: p.OS,
      online: p.Online,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { self: status.Self, devices, certDomains: status.CertDomains };
}
const serveSchema = z.object({
  TCP: z
    .record(z.string(), z.object({ HTTPS: z.boolean().optional() }))
    .default({}),
  Web: z
    .record(
      z.string(),
      z.object({
        Handlers: z.record(
          z.string(),
          z.object({ Proxy: z.string().optional() }),
        ),
      }),
    )
    .default({}),
  AllowFunnel: z.record(z.string(), z.boolean()).default({}),
});
export function validateServe(
  raw: string,
  dns: string,
  port: number,
  loopback: string,
): string {
  const config = serveSchema.parse(JSON.parse(raw));
  const authority = `${dns}:${port}`;
  if (config.AllowFunnel[authority])
    throw new Error(
      "This endpoint uses Funnel. Configure a private Serve endpoint on another port.",
    );
  const handlers = config.Web[authority]?.Handlers;
  if (
    config.TCP[String(port)]?.HTTPS !== true ||
    !handlers ||
    Object.keys(handlers).length !== 1 ||
    handlers["/"]?.Proxy?.replace(/\/$/, "") !== loopback.replace(/\/$/, "")
  )
    throw new Error(
      "Configure a dedicated HTTPS Serve endpoint forwarding / to this bb server, then verify it.",
    );
  return `https://${authority}`;
}
export interface TailscaleClient {
  status(signal: AbortSignal): Promise<ReturnType<typeof parseStatus>>;
  serveStatus(signal: AbortSignal): Promise<string>;
}
async function executable() {
  if (process.platform === "darwin") {
    const path = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    )
      return path;
  }
  return "tailscale";
}
export function createTailscaleClient(): TailscaleClient {
  async function run(args: string[], signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const bin = await executable();
    return new Promise((resolve, reject) => {
      execFile(
        bin,
        args,
        { signal, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => {
          if (error)
            reject(
              new Error(
                "Tailscale CLI is unavailable. Check installation and sign-in on the bb server machine.",
              ),
            );
          else resolve(stdout);
        },
      );
    });
  }
  return {
    status: async (signal) =>
      parseStatus(await run(["status", "--json"], signal)),
    serveStatus: (signal) => run(["serve", "status", "--json"], signal),
  };
}
