import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { rootCertificates } from "node:tls";
import {
  FRP_CREDENTIAL_META,
  FRP_WEBSOCKET_PATH,
} from "@bb/tunnel-contract/next";

export const NEXT_SERVER_OVERRIDE_ENV = "BB_CONNECT_NEXT_SERVER";

export interface TunnelServer {
  protocol: "websocket" | "wss";
  host: string;
  port: number;
}

export function tunnelServerUrl(server: TunnelServer): string {
  const scheme = server.protocol === "wss" ? "wss" : "ws";
  const defaultPort = server.protocol === "wss" ? 443 : 80;
  const port = server.port === defaultPort ? "" : `:${server.port}`;
  return `${scheme}://${server.host}${port}${FRP_WEBSOCKET_PATH}`;
}

export function parseTunnelServer(
  value: string | undefined,
  envName: string = NEXT_SERVER_OVERRIDE_ENV,
): TunnelServer | null {
  if (value === undefined || value.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${envName} must be a ws:// or wss:// URL, got ${value}`);
  }
  const protocol =
    url.protocol === "wss:"
      ? "wss"
      : url.protocol === "ws:"
        ? "websocket"
        : null;
  if (protocol === null) {
    throw new Error(`${envName} must be a ws:// or wss:// URL, got ${value}`);
  }
  if (url.pathname !== "/" && url.pathname !== FRP_WEBSOCKET_PATH) {
    throw new Error(
      `${envName} cannot choose a path; frp always dials ${FRP_WEBSOCKET_PATH}`,
    );
  }
  const port =
    url.port === "" ? (protocol === "wss" ? 443 : 80) : Number(url.port);
  return { protocol, host: url.hostname.replace(/^\[|\]$/gu, ""), port };
}

export interface FrpProxy {
  name: string;
  subdomain: string;
  localIP: string;
  localPort: number;
  hostHeaderRewrite: string | null;
}

export function loopbackTarget(baseUrl: string): {
  localIP: string;
  localPort: number;
} {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:") {
    throw new Error(
      `an frp proxy target must be plain http on loopback, got ${baseUrl}`,
    );
  }
  return {
    localIP: url.hostname.replace(/^\[|\]$/gu, ""),
    localPort: url.port === "" ? 80 : Number(url.port),
  };
}

export interface FrpcAdmin {
  port: number;
  user: string;
  password: string;
}

export async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("could not pick a loopback port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

export async function createFrpcAdmin(): Promise<FrpcAdmin> {
  return {
    port: await freeLoopbackPort(),
    user: `bb-${randomBytes(6).toString("hex")}`,
    password: randomBytes(24).toString("base64url"),
  };
}

export interface FrpcConfigInput {
  server: TunnelServer;
  user: string;
  credential: string;
  proxies: readonly FrpProxy[];
  trustedCaFile: string | null;
  admin: FrpcAdmin | null;
}

export function buildFrpcConfig(input: FrpcConfigInput) {
  return {
    serverAddr: input.server.host,
    serverPort: input.server.port,
    user: input.user,
    loginFailExit: false,
    metadatas: { [FRP_CREDENTIAL_META]: input.credential },
    log: { to: "console", level: "info", disablePrintColor: true },
    ...(input.admin === null
      ? {}
      : {
          webServer: {
            addr: "127.0.0.1",
            port: input.admin.port,
            user: input.admin.user,
            password: input.admin.password,
          },
        }),
    transport: {
      protocol: input.server.protocol,
      ...(input.server.protocol === "wss"
        ? {
            tls: {
              enable: true,
              serverName: input.server.host,
              ...(input.trustedCaFile === null
                ? {}
                : { trustedCaFile: input.trustedCaFile }),
            },
          }
        : {}),
    },
    proxies: input.proxies.map((proxy) => ({
      name: proxy.name,
      type: "http",
      localIP: proxy.localIP,
      localPort: proxy.localPort,
      subdomain: proxy.subdomain,
      ...(proxy.hostHeaderRewrite === null
        ? {}
        : { hostHeaderRewrite: proxy.hostHeaderRewrite }),
    })),
  };
}

export type FrpcConfig = ReturnType<typeof buildFrpcConfig>;

async function writePrivateFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, content, { mode: 0o600 });
  await fs.chmod(file, 0o600);
}

export async function writeFrpcConfig(
  file: string,
  config: FrpcConfig,
): Promise<void> {
  await writePrivateFile(file, `${JSON.stringify(config, null, 2)}\n`);
}

export async function defaultTrustedCertificates(
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const extra = env.NODE_EXTRA_CA_CERTS;
  const certificates = [...rootCertificates];
  if (extra !== undefined && extra !== "") {
    certificates.push(await fs.readFile(extra, "utf8"));
  }
  return certificates;
}

export async function writeTrustedCaFile(
  file: string,
  certificates: readonly string[],
): Promise<void> {
  await writePrivateFile(file, `${certificates.join("\n")}\n`);
}
