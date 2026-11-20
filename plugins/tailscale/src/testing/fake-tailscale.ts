import type { TailscaleCli, TailscaleRunResult } from "../tailscale-cli.js";

export interface FakeNode {
  backendState: string;
  dnsName: string;
  tailnet: string;
  magicDns: boolean;
  https: boolean;
}

export interface FakeHandler {
  proxy: string;
  funnel?: boolean;
}

export class FakeTailscale implements TailscaleCli {
  readonly path = "/fake/tailscale";
  node: FakeNode = {
    backendState: "Running",
    dnsName: "mini.tail1234.ts.net",
    tailnet: "tail1234.ts.net",
    magicDns: true,
    https: true,
  };
  readonly web = new Map<number, FakeHandler>();
  readonly tcpForwards = new Set<number>();
  readonly foregroundPorts = new Set<number>();
  readonly calls: string[][] = [];
  daemonDown = false;
  denyWrites = false;

  map(port: number, proxy: string, options: { funnel?: boolean } = {}) {
    this.web.set(port, { proxy, funnel: options.funnel ?? false });
  }

  get mutations(): string[][] {
    return this.calls.filter(
      (args) => args[0] === "serve" && args[1] !== "status",
    );
  }

  async run(args: readonly string[]): Promise<TailscaleRunResult> {
    this.calls.push([...args]);
    if (this.daemonDown) {
      return {
        exitCode: 1,
        stdout: "",
        stderr:
          "failed to connect to local tailscaled; it doesn't appear to be running\n",
      };
    }
    const [command, ...rest] = args;
    if (command === "status" && rest.join(" ") === "--json") {
      return ok(JSON.stringify(this.statusJson()));
    }
    if (command === "serve" && rest.join(" ") === "status --json") {
      return ok(JSON.stringify(this.serveJson()));
    }
    if (command === "serve") return this.serve(rest);
    return fail(`unknown command: ${args.join(" ")}`);
  }

  private serve(args: readonly string[]): TailscaleRunResult {
    const https = args.find((arg) => arg.startsWith("--https="));
    const target = args.at(-1);
    if (https === undefined || target === undefined) {
      return fail("fake tailscale expects --https=<port> and a target");
    }
    if (this.denyWrites) {
      return fail(
        "sending serve config: Access denied: serve config denied\nUse 'sudo tailscale serve ...' or 'sudo tailscale set --operator=$USER'",
      );
    }
    const port = Number(https.slice("--https=".length));
    if (target === "off") {
      if (!this.web.has(port)) return fail("error: handler does not exist");
      this.web.delete(port);
      return ok("");
    }
    if (!args.includes("--bg")) return fail("fake tailscale only runs --bg");
    if (this.tcpForwards.has(port)) {
      return fail(`port ${port} is already serving TCP`);
    }
    this.web.set(port, { proxy: target });
    return ok(
      `Available within your tailnet:\n\nhttps://${this.node.dnsName}\n`,
    );
  }

  private statusJson() {
    const signedIn = this.node.backendState !== "NeedsLogin";
    return {
      Version: "1.104.7-tfb3b9b296-g0651cc45e",
      BackendState: this.node.backendState,
      MagicDNSSuffix: this.node.tailnet,
      CurrentTailnet: signedIn
        ? {
            Name: "someone@example.com",
            MagicDNSSuffix: this.node.tailnet,
            MagicDNSEnabled: this.node.magicDns,
          }
        : null,
      CertDomains: this.node.https ? [this.node.dnsName] : null,
      Self: {
        HostName: "mini",
        TailscaleIPs: ["100.64.0.7", "fd7a:115c:a1e0::7"],
        DNSName: signedIn && this.node.magicDns ? `${this.node.dnsName}.` : "",
      },
    };
  }

  private serveJson() {
    if (
      this.web.size === 0 &&
      this.tcpForwards.size === 0 &&
      this.foregroundPorts.size === 0
    ) {
      return {};
    }
    const tcp: Record<string, object> = {};
    const web: Record<string, object> = {};
    const funnel: Record<string, boolean> = {};
    for (const port of this.tcpForwards) {
      tcp[String(port)] = { TCPForward: "127.0.0.1:22" };
    }
    for (const [port, handler] of this.web) {
      const host = `${this.node.dnsName}:${port}`;
      tcp[String(port)] = { HTTPS: true };
      web[host] = { Handlers: { "/": { Proxy: handler.proxy } } };
      if (handler.funnel) funnel[host] = true;
    }
    const foreground: Record<string, { TCP: Record<string, object> }> = {};
    for (const port of this.foregroundPorts) {
      foreground[`session-${port}`] = {
        TCP: { [String(port)]: { HTTPS: true } },
      };
    }
    return {
      TCP: tcp,
      Web: web,
      ...(Object.keys(funnel).length > 0 ? { AllowFunnel: funnel } : {}),
      ...(Object.keys(foreground).length > 0 ? { Foreground: foreground } : {}),
    };
  }
}

function ok(stdout: string): TailscaleRunResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr: string): TailscaleRunResult {
  return { exitCode: 1, stdout: "", stderr: `${stderr}\n` };
}
