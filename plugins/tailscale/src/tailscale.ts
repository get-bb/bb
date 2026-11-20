import { connect } from "node:net";
import {
  TAILSCALE_ADMIN_DNS_URL,
  findBbMapping,
  freeServePorts,
  servePortCandidates,
  parseNodeStatus,
  parseServeConfig,
  serveUrl,
  type ServeConfig,
  type TailscaleNode,
} from "./serve-config.js";
import type { LocateTailscale, TailscaleCli } from "./tailscale-cli.js";
import type {
  TailscaleProbe,
  TailscaleServe,
  TailscaleState,
  TailscaleStatus,
} from "./types.js";

export interface OwnedMapping {
  port: number;
  target: string;
}

export interface OwnershipStore {
  get(): Promise<OwnedMapping | null>;
  set(mapping: OwnedMapping): Promise<void>;
  clear(): Promise<void>;
}

export interface TailscaleTiming {
  readMs: number;
  writeMs: number;
  probeMs: number;
  probeRetryMs: number;
  freshMs: number;
}

const DEFAULT_TIMING: TailscaleTiming = {
  readMs: 10_000,
  writeMs: 30_000,
  probeMs: 4_000,
  probeRetryMs: 250,
  freshMs: 5_000,
};

export interface TailscaleOptions {
  locate: LocateTailscale;
  target: () => string;
  ownership: OwnershipStore;
  fetch: typeof fetch;
  now?: () => number;
  timing?: Partial<TailscaleTiming>;
  onChange?: (status: TailscaleStatus, availabilityChanged: boolean) => void;
  listening?: (address: string, port: number) => Promise<boolean>;
}

interface Snapshot {
  status: TailscaleStatus;
  cli: TailscaleCli | null;
  node: TailscaleNode | null;
  config: ServeConfig | null;
}

interface Read {
  state: Promise<Snapshot>;
  probed: Promise<Snapshot>;
}

const UNAVAILABLE_STATES: ReadonlySet<TailscaleState> = new Set([
  "not-installed",
  "not-running",
  "logged-out",
  "needs-approval",
  "error",
]);

export type TailscaleAvailability =
  | { status: "available"; serverUrl: string }
  | { status: "setup-required"; message: string }
  | { status: "unavailable"; message: string };

export function availabilityOf(status: TailscaleStatus): TailscaleAvailability {
  if (status.state === "served" && status.serve !== null) {
    return { status: "available", serverUrl: status.serve.url };
  }
  const message = status.message ?? "Tailscale is not ready";
  return UNAVAILABLE_STATES.has(status.state)
    ? { status: "unavailable", message }
    : { status: "setup-required", message };
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  );
}

export function commandFailure(
  args: readonly string[],
  stderr: string,
  stdout: string,
): string {
  const detail = firstLine(stderr) || firstLine(stdout);
  if (/access denied/iu.test(stderr) || /operator/iu.test(stderr)) {
    return "Tailscale refused to change Serve for this user. Run `sudo tailscale set --operator=$USER` on the server's machine, then try again.";
  }
  return `tailscale ${args.join(" ")} failed${detail === "" ? "" : `: ${detail}`}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Tailscale {
  private readonly options: TailscaleOptions;
  private readonly timing: TailscaleTiming;
  private readonly now: () => number;
  private snapshot: Snapshot | null = null;
  private inflight: Read | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: TailscaleOptions) {
    this.options = options;
    this.timing = { ...DEFAULT_TIMING, ...options.timing };
    this.now = options.now ?? Date.now;
  }

  cached(): TailscaleStatus | null {
    return this.snapshot?.status ?? null;
  }

  async status(options: { maxAgeMs?: number } = {}): Promise<TailscaleStatus> {
    const maxAgeMs = options.maxAgeMs ?? this.timing.freshMs;
    const current = this.snapshot;
    if (current !== null && this.now() - current.status.checkedAt < maxAgeMs) {
      return current.status;
    }
    return (await this.refresh()).status;
  }

  async availability(): Promise<TailscaleAvailability> {
    const current = this.snapshot;
    if (
      current !== null &&
      this.now() - current.status.checkedAt < this.timing.freshMs
    ) {
      return availabilityOf(current.status);
    }
    return availabilityOf((await this.start().state).status);
  }

  refresh(): Promise<Snapshot> {
    return this.start().probed;
  }

  private start(): Read {
    if (this.inflight !== null) return this.inflight;
    const state = this.read().finally(() => {
      if (this.inflight === entry) this.inflight = null;
    });
    const probed = state.then((snapshot) => this.withProbe(snapshot));
    probed.catch(() => undefined);
    const entry: Read = { state, probed };
    this.inflight = entry;
    return entry;
  }

  private async withProbe(snapshot: Snapshot): Promise<Snapshot> {
    const serve = snapshot.status.serve;
    if (serve === null) return snapshot;
    const probed: Snapshot = {
      ...snapshot,
      status: { ...snapshot.status, https: await this.probe(serve.url) },
    };
    if (this.snapshot === snapshot) this.publish(probed);
    return probed;
  }

  setup(): Promise<TailscaleStatus> {
    return this.serialized(async () => {
      const snapshot = await this.fresh();
      const { status, cli, node, config } = snapshot;
      if (status.state === "served") return status;
      if (
        status.state !== "not-served" ||
        cli === null ||
        node?.dnsName == null ||
        config === null
      ) {
        throw new Error(status.message ?? "Tailscale is not ready");
      }
      const target = this.options.target();
      const port = await this.pickPort(node, config, target);
      if (port === null) throw new Error(conflictMessage(target));
      await this.serve(cli, port, target);
      await this.options.ownership.set({ port, target });
      const after = await this.fresh();
      if (after.status.state !== "served") {
        throw new Error(
          after.status.message ??
            "Tailscale accepted the Serve command but bb's mapping is not listed",
        );
      }
      return after.status;
    });
  }

  teardown(): Promise<TailscaleStatus> {
    return this.serialized(async () => {
      const owned = await this.options.ownership.get();
      const snapshot = await this.fresh();
      if (owned === null) {
        const serve = snapshot.status.serve;
        if (serve?.owner === "adopted") {
          throw new Error(
            `bb didn't create the Tailscale Serve mapping at ${serve.url}, so it leaves it alone. Remove it yourself with \`tailscale serve --https=${serve.port} off\`.`,
          );
        }
        return snapshot.status;
      }
      if (this.isOurs(snapshot, owned) && snapshot.cli !== null) {
        await this.serveOff(snapshot.cli, owned.port);
      }
      await this.options.ownership.clear();
      return (await this.fresh()).status;
    });
  }

  private async pickPort(
    node: TailscaleNode,
    config: ServeConfig,
    target: string,
  ): Promise<number | null> {
    const listening = this.options.listening ?? listeningOn;
    for (const port of freeServePorts(config, target)) {
      const taken = await Promise.all(
        node.addresses.map((address) => listening(address, port)),
      );
      if (!taken.includes(true)) return port;
    }
    return null;
  }

  private isOurs(snapshot: Snapshot, owned: OwnedMapping): boolean {
    const { node, config } = snapshot;
    if (node?.dnsName == null || config === null) return false;
    const mapping = findBbMapping(config, node.dnsName, owned.target);
    return mapping?.port === owned.port;
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async fresh(): Promise<Snapshot> {
    if (this.inflight !== null) {
      await this.inflight.state.catch(() => undefined);
    }
    return this.refresh();
  }

  private async serve(
    cli: TailscaleCli,
    port: number,
    target: string,
  ): Promise<void> {
    const args = ["serve", "--bg", "--yes", `--https=${port}`, target];
    const result = await cli.run(args, { timeoutMs: this.timing.writeMs });
    if (result.exitCode !== 0) {
      throw new Error(commandFailure(args, result.stderr, result.stdout));
    }
  }

  private async serveOff(cli: TailscaleCli, port: number): Promise<void> {
    const args = ["serve", "--yes", `--https=${port}`, "off"];
    const result = await cli.run(args, { timeoutMs: this.timing.writeMs });
    if (result.exitCode !== 0) {
      throw new Error(commandFailure(args, result.stderr, result.stdout));
    }
  }

  private async read(): Promise<Snapshot> {
    const target = this.options.target();
    const base = {
      target,
      cliPath: null,
      version: null,
      tailnet: null,
      dnsName: null,
      serve: null,
      https: null,
      adminUrl: null,
    };
    let snapshot: Snapshot;
    const cli = await this.options.locate();
    if (cli === null) {
      snapshot = {
        cli: null,
        node: null,
        config: null,
        status: {
          ...base,
          state: "not-installed",
          message:
            "Install Tailscale on this server's machine to reach bb over your tailnet",
          adminUrl: "https://tailscale.com/download",
          checkedAt: this.now(),
        },
      };
    } else {
      snapshot = await this.readNode(cli, { ...base, cliPath: cli.path });
    }
    this.publish(snapshot);
    return snapshot;
  }

  private publish(snapshot: Snapshot): void {
    const previous = this.snapshot?.status ?? null;
    this.snapshot = snapshot;
    this.notify(previous, snapshot.status);
  }

  private async readNode(
    cli: TailscaleCli,
    base: Omit<TailscaleStatus, "state" | "message" | "checkedAt">,
  ): Promise<Snapshot> {
    const failed = (
      state: TailscaleState,
      message: string,
      node: TailscaleNode | null = null,
      extra: Partial<TailscaleStatus> = {},
    ): Snapshot => ({
      cli,
      node,
      config: null,
      status: {
        ...base,
        ...extra,
        state,
        message,
        checkedAt: this.now(),
      },
    });
    let node: TailscaleNode;
    try {
      const result = await cli.run(["status", "--json"], {
        timeoutMs: this.timing.readMs,
      });
      if (result.exitCode !== 0 && result.stdout.trim() === "") {
        const detail = firstLine(result.stderr);
        return failed(
          "not-running",
          `Tailscale isn't running on this server's machine${detail === "" ? "" : ` (${detail})`}`,
        );
      }
      node = parseNodeStatus(result.stdout);
    } catch (error) {
      return failed(
        "error",
        `Couldn't read Tailscale status: ${errorMessage(error)}`,
      );
    }
    const nodeFields = {
      version: node.version,
      tailnet: node.tailnet,
      dnsName: node.dnsName,
    };
    switch (node.backendState) {
      case "Running":
        break;
      case "NeedsLogin":
        return failed(
          "logged-out",
          "Sign in to Tailscale on this server's machine",
          node,
          nodeFields,
        );
      case "NeedsMachineAuth":
        return failed(
          "needs-approval",
          "This machine is waiting for approval in the Tailscale admin console",
          node,
          {
            ...nodeFields,
            adminUrl: "https://login.tailscale.com/admin/machines",
          },
        );
      default:
        return failed(
          "not-running",
          `Tailscale is ${node.backendState === "Stopped" ? "disconnected" : node.backendState.toLowerCase()} on this server's machine; connect it to reach bb over your tailnet`,
          node,
          nodeFields,
        );
    }
    if (!node.magicDns || node.dnsName === null) {
      return failed(
        "needs-magicdns",
        "Turn on MagicDNS in your tailnet's DNS settings",
        node,
        { ...nodeFields, adminUrl: TAILSCALE_ADMIN_DNS_URL },
      );
    }
    if (!node.https) {
      return failed(
        "needs-https",
        "Turn on HTTPS certificates in your tailnet's DNS settings",
        node,
        { ...nodeFields, adminUrl: TAILSCALE_ADMIN_DNS_URL },
      );
    }
    let config: ServeConfig;
    try {
      const result = await cli.run(["serve", "status", "--json"], {
        timeoutMs: this.timing.readMs,
      });
      if (result.exitCode !== 0) {
        throw new Error(
          commandFailure(
            ["serve", "status", "--json"],
            result.stderr,
            result.stdout,
          ),
        );
      }
      config = parseServeConfig(result.stdout);
    } catch (error) {
      return failed(
        "error",
        `Couldn't read Tailscale Serve: ${errorMessage(error)}`,
        node,
        nodeFields,
      );
    }
    const dnsName = node.dnsName;
    const mapping = findBbMapping(config, dnsName, base.target);
    if (mapping === null) {
      const free = freeServePorts(config, base.target);
      return {
        cli,
        node,
        config,
        status: {
          ...base,
          ...nodeFields,
          state: free.length === 0 ? "conflict" : "not-served",
          message:
            free.length === 0
              ? conflictMessage(base.target)
              : "Set up Tailscale Serve for bb in Settings → Tailscale, or run bb tailscale setup",
          checkedAt: this.now(),
        },
      };
    }
    const owned = await this.options.ownership.get();
    const url = serveUrl(dnsName, mapping.port);
    const previous = this.snapshot?.status;
    const serve: TailscaleServe = {
      port: mapping.port,
      url,
      owner:
        owned?.port === mapping.port && owned.target === base.target
          ? "bb"
          : "adopted",
      funnel: mapping.funnel,
    };
    return {
      cli,
      node,
      config,
      status: {
        ...base,
        ...nodeFields,
        state: "served",
        message: mapping.funnel
          ? `Tailscale Funnel is on for this address, so anyone on the internet can reach bb. Turn it off with \`tailscale funnel --https=${mapping.port} off\`.`
          : null,
        serve,
        https: previous?.serve?.url === url ? previous.https : null,
        checkedAt: this.now(),
      },
    };
  }

  private async probe(url: string): Promise<TailscaleProbe> {
    const checkedAt = this.now();
    const fetchHealth = async (base: string) => {
      const signal = AbortSignal.timeout(this.timing.probeMs);
      let response = await this.options.fetch(`${base}/health`, { signal });
      for (
        let retries = FORBIDDEN_RETRIES;
        response.status === 403 && retries > 0;
        retries -= 1
      ) {
        await delay(this.timing.probeRetryMs, signal);
        response = await this.options.fetch(`${base}/health`, { signal });
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body: unknown = await response.json();
      return typeof body === "object" &&
        body !== null &&
        "launchId" in body &&
        typeof body.launchId === "string"
        ? body.launchId
        : null;
    };
    let probe: TailscaleProbe;
    try {
      const [remote, local] = await Promise.all([
        fetchHealth(url),
        fetchHealth(this.options.target()).catch(() => null),
      ]);
      probe =
        remote !== null && local !== null && remote !== local
          ? {
              result: "other-server",
              error: `${url} answers, but it is a different bb server`,
              checkedAt,
            }
          : { result: "ok", error: null, checkedAt };
    } catch (error) {
      probe = {
        result: "no-answer",
        error: `${url}/health didn't answer: ${errorMessage(error)}`,
        checkedAt,
      };
    }
    return probe;
  }

  private notify(previous: TailscaleStatus | null, next: TailscaleStatus) {
    const key = (status: TailscaleStatus) =>
      JSON.stringify({ ...status, checkedAt: 0, https: status.https?.result });
    if (previous !== null && key(previous) === key(next)) return;
    const availability = (status: TailscaleStatus | null) =>
      status === null ? null : JSON.stringify(availabilityOf(status));
    this.options.onChange?.(
      next,
      previous !== null && availability(previous) !== availability(next),
    );
  }
}

const FORBIDDEN_RETRIES = 8;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function conflictMessage(target: string): string {
  const ports = servePortCandidates(target).join(" and ");
  return `Ports ${ports} on this machine's tailnet address are already in use by other services. Free one (for a Tailscale Serve mapping, \`tailscale serve --https=<port> off\`), then set up again.`;
}

export function listeningOn(
  address: string,
  port: number,
  timeoutMs = 750,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: address, port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
