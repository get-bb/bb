import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  buildFrpcConfig,
  createFrpcAdmin,
  writeFrpcConfig,
  writeTrustedCaFile,
  type FrpProxy,
  type FrpcAdmin,
  type TunnelServer,
} from "./config.js";
import { cleanFrpcLine, parseFrpcLine } from "./log.js";

export interface FrpcLogger {
  info(message: string): void;
  warn(message: string): void;
}

export type FrpcState =
  | "idle"
  | "connecting"
  | "connected"
  | "refused"
  | "offline"
  | "error"
  | "halted";

export type FrpcProxyState = "pending" | "active" | "refused";

export interface FrpcProxyStatus {
  name: string;
  subdomain: string;
  localPort: number;
  state: FrpcProxyState;
  error: string | null;
}

export interface FrpcSupervisorStatus {
  state: FrpcState;
  lastError: string | null;
  nextRetryAt: number | null;
  since: number;
  proxies: FrpcProxyStatus[];
}

export interface FrpcLaunch {
  kind: "launch";
  server: TunnelServer;
  user: string;
  credential: string;
}

export type FrpcPrepared = FrpcLaunch | { kind: "halt"; reason: string };

export interface FrpcTiming {
  restartMinMs: number;
  restartMaxMs: number;
  stableMs: number;
  refusedRetryMs: number;
  stopGraceMs: number;
  reloadTimeoutMs: number;
}

export const DEFAULT_FRPC_TIMING: FrpcTiming = {
  restartMinMs: 1_000,
  restartMaxMs: 30_000,
  stableMs: 10_000,
  refusedRetryMs: 5 * 60_000,
  stopGraceMs: 3_000,
  reloadTimeoutMs: 5_000,
};

export type FrpcReloadRequest = (
  admin: FrpcAdmin,
  timeoutMs: number,
) => Promise<void>;

export const requestFrpcReload: FrpcReloadRequest = async (
  admin,
  timeoutMs,
) => {
  const authorization = Buffer.from(`${admin.user}:${admin.password}`).toString(
    "base64",
  );
  const response = await fetch(`http://127.0.0.1:${admin.port}/api/reload`, {
    headers: { authorization: `Basic ${authorization}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`frpc reload answered HTTP ${response.status} ${body}`);
  }
};

export interface FrpcSupervisorOptions {
  frpDir: string;
  primaryProxy: string | null;
  resolveBinary(): Promise<string>;
  trustedCertificates(): Promise<string[]>;
  prepare(): Promise<FrpcPrepared>;
  proxies(): readonly FrpProxy[];
  log: FrpcLogger;
  onStatusChange?(status: FrpcSupervisorStatus): void;
  timing?: Partial<FrpcTiming>;
  requestReload?: FrpcReloadRequest;
}

interface Running {
  child: ChildProcess;
  startedAt: number;
  launch: FrpcLaunch;
  admin: FrpcAdmin;
  configFile: string;
  written: FrpProxy[];
  restartNow: boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, ms);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function sameProxy(left: FrpProxy, right: FrpProxy): boolean {
  return (
    left.name === right.name &&
    left.subdomain === right.subdomain &&
    left.localIP === right.localIP &&
    left.localPort === right.localPort &&
    left.hostHeaderRewrite === right.hostHeaderRewrite
  );
}

export function frpProxyDiff(
  current: readonly FrpProxy[],
  next: readonly FrpProxy[],
): { added: FrpProxy[]; removed: FrpProxy[]; changed: FrpProxy[] } {
  const before = new Map(current.map((proxy) => [proxy.name, proxy]));
  const after = new Map(next.map((proxy) => [proxy.name, proxy]));
  const added: FrpProxy[] = [];
  const changed: FrpProxy[] = [];
  for (const proxy of next) {
    const previous = before.get(proxy.name);
    if (previous === undefined) added.push(proxy);
    else if (!sameProxy(previous, proxy)) changed.push(proxy);
  }
  const removed = current.filter((proxy) => !after.has(proxy.name));
  return { added, removed, changed };
}

export class FrpcSupervisor {
  private readonly timing: FrpcTiming;
  private readonly requestReload: FrpcReloadRequest;
  private active = false;
  private running: Running | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private state: FrpcState = "idle";
  private lastError: string | null = null;
  private nextRetryAt: number | null = null;
  private since = Date.now();
  private proxies: FrpProxy[] = [];
  private proxyStates = new Map<
    string,
    { state: FrpcProxyState; error: string | null }
  >();
  private lastPublished = "";
  private reloads: Promise<void> = Promise.resolve();
  private launches = 0;

  constructor(private readonly options: FrpcSupervisorOptions) {
    this.timing = { ...DEFAULT_FRPC_TIMING, ...options.timing };
    this.requestReload = options.requestReload ?? requestFrpcReload;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.attempts = 0;
    this.setState("connecting", null);
    void this.launch(this.launches);
  }

  async stop(): Promise<void> {
    this.active = false;
    this.launches += 1;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.nextRetryAt = null;
    const running = this.running;
    this.running = null;
    if (running !== null) await this.killChild(running.child);
    await this.reloads;
    for (const entry of this.proxyStates.values()) {
      entry.state = "pending";
      entry.error = null;
    }
    this.setState("idle", null);
  }

  childPid(): number | null {
    return this.running?.child.pid ?? null;
  }

  status(): FrpcSupervisorStatus {
    return {
      state: this.state,
      lastError: this.lastError,
      nextRetryAt: this.nextRetryAt,
      since: this.since,
      proxies: this.proxies.map((proxy) => {
        const entry = this.proxyStates.get(proxy.name);
        return {
          name: proxy.name,
          subdomain: proxy.subdomain,
          localPort: proxy.localPort,
          state: entry?.state ?? "pending",
          error: entry?.error ?? null,
        };
      }),
    };
  }

  proxiesChanged(): Promise<void> {
    const next = [...this.options.proxies()];
    const diff = frpProxyDiff(this.proxies, next);
    if (
      diff.added.length === 0 &&
      diff.removed.length === 0 &&
      diff.changed.length === 0
    ) {
      return this.reloads;
    }
    this.adoptProxies(next);
    this.publish();
    this.reloads = this.reloads.then(() => this.reload());
    return this.reloads;
  }

  idle(): Promise<void> {
    return this.reloads;
  }

  private adoptProxies(next: FrpProxy[]): void {
    const diff = frpProxyDiff(this.proxies, next);
    for (const proxy of diff.removed) this.proxyStates.delete(proxy.name);
    for (const proxy of [...diff.added, ...diff.changed]) {
      this.proxyStates.set(proxy.name, { state: "pending", error: null });
    }
    this.proxies = next;
  }

  private async reload(): Promise<void> {
    const running = this.running;
    if (running === null || running.restartNow) return;
    try {
      running.written = this.proxies;
      await this.writeConfig(running);
      if (this.running !== running) return;
      await this.requestReload(running.admin, this.timing.reloadTimeoutMs);
    } catch (error) {
      if (this.running !== running) return;
      this.options.log.warn(
        `frpc did not reload its proxies (${errorText(error)}); restarting it`,
      );
      running.restartNow = true;
      await this.killChild(running.child);
    }
  }

  private configFor(
    running: Pick<Running, "launch" | "admin">,
    proxies: readonly FrpProxy[],
  ) {
    return buildFrpcConfig({
      server: running.launch.server,
      user: running.launch.user,
      credential: running.launch.credential,
      proxies,
      trustedCaFile:
        running.launch.server.protocol === "wss"
          ? path.join(this.options.frpDir, "roots.pem")
          : null,
      admin: running.admin,
    });
  }

  private async writeConfig(
    running: Pick<Running, "launch" | "admin" | "configFile" | "written">,
  ): Promise<void> {
    await writeFrpcConfig(
      running.configFile,
      this.configFor(running, running.written),
    );
  }

  private current(launch: number): boolean {
    return this.active && launch === this.launches;
  }

  private async launch(launch: number): Promise<void> {
    try {
      const prepared = await this.options.prepare();
      if (!this.current(launch)) return;
      if (prepared.kind === "halt") {
        this.setState("halted", prepared.reason);
        return;
      }
      this.adoptProxies([...this.options.proxies()]);
      const binary = await this.options.resolveBinary();
      if (!this.current(launch)) return;
      const trustedCaFile =
        prepared.server.protocol === "wss"
          ? path.join(this.options.frpDir, "roots.pem")
          : null;
      if (trustedCaFile !== null) {
        await writeTrustedCaFile(
          trustedCaFile,
          await this.options.trustedCertificates(),
        );
      }
      const admin = await createFrpcAdmin();
      const configFile = path.join(this.options.frpDir, "frpc.json");
      const setup = {
        launch: prepared,
        admin,
        configFile,
        written: this.proxies,
      };
      await this.writeConfig(setup);
      if (!this.current(launch)) return;
      this.spawnChild(launch, binary, setup);
    } catch (error) {
      if (!this.current(launch)) return;
      const message = errorText(error);
      this.options.log.warn(`frpc could not start: ${message}`);
      this.setState("error", message);
      this.scheduleRelaunch(this.backoff());
    }
  }

  private spawnChild(
    launch: number,
    binary: string,
    setup: Omit<Running, "child" | "startedAt" | "restartNow">,
  ): void {
    const child = spawn(binary, ["-c", setup.configFile], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const running: Running = {
      ...setup,
      child,
      startedAt: Date.now(),
      restartNow: false,
    };
    this.running = running;
    for (const entry of this.proxyStates.values()) {
      entry.state = "pending";
      entry.error = null;
    }
    this.setState("connecting", this.lastError);
    const secrets = [setup.launch.credential, setup.admin.password];
    for (const stream of [child.stdout, child.stderr]) {
      if (stream === null) continue;
      createInterface({ input: stream }).on("line", (line) => {
        this.onLine(launch, running, cleanFrpcLine(line, secrets));
      });
    }
    child.once("error", (error) => {
      this.onChildEnd(launch, running, `frpc failed: ${error.message}`);
    });
    child.once("exit", (code, signal) => {
      this.onChildEnd(
        launch,
        running,
        `frpc exited (${signal === null ? `code ${code}` : signal})`,
      );
    });
    if (running.written !== this.proxies) {
      this.reloads = this.reloads.then(() => this.reload());
    }
  }

  private onLine(launch: number, running: Running, line: string): void {
    if (line === "") return;
    this.options.log.info(`frpc: ${line}`);
    if (!this.current(launch) || this.running !== running) return;
    const event = parseFrpcLine(line);
    if (event === null) return;
    const primary = this.options.primaryProxy;
    switch (event.kind) {
      case "connecting":
        for (const entry of this.proxyStates.values()) {
          if (entry.state === "active") entry.state = "pending";
        }
        if (this.state === "connected") this.setState("connecting", null);
        else this.publish();
        return;
      case "logged-in":
        if (primary === null) {
          this.attempts = 0;
          this.setState("connected", null);
        }
        return;
      case "proxy-started": {
        const entry = this.proxyStates.get(event.proxy);
        if (entry !== undefined) {
          entry.state = "active";
          entry.error = null;
        }
        if (event.proxy === primary) {
          this.attempts = 0;
          this.setState("connected", null);
        } else {
          this.publish();
        }
        return;
      }
      case "proxy-refused": {
        if (event.proxy === primary) {
          this.onRefused(running, event.reason);
          return;
        }
        const entry = this.proxyStates.get(event.proxy);
        if (entry !== undefined) {
          entry.state = "refused";
          entry.error = event.reason;
        }
        this.publish();
        return;
      }
      case "proxy-removed":
        return;
      case "offline":
        for (const entry of this.proxyStates.values()) {
          if (entry.state === "active") entry.state = "pending";
        }
        this.setState("offline", event.reason);
        return;
      case "refused":
        this.onRefused(running, event.reason);
        return;
    }
  }

  private onRefused(running: Running, reason: string): void {
    this.running = null;
    this.setState("refused", reason);
    void this.killChild(running.child);
    this.scheduleRelaunch(this.timing.refusedRetryMs);
  }

  private onChildEnd(launch: number, running: Running, reason: string): void {
    if (!this.current(launch) || this.running !== running) return;
    this.running = null;
    if (running.restartNow) {
      this.setState("connecting", null);
      void this.launch(launch);
      return;
    }
    if (Date.now() - running.startedAt > this.timing.stableMs) {
      this.attempts = 0;
    }
    this.options.log.warn(reason);
    this.setState("connecting", reason);
    this.scheduleRelaunch(this.backoff());
  }

  private scheduleRelaunch(delayMs: number): void {
    const launch = this.launches;
    clearTimeout(this.timer);
    this.nextRetryAt = Date.now() + delayMs;
    this.publish();
    this.timer = setTimeout(() => {
      if (!this.current(launch)) return;
      this.nextRetryAt = null;
      void this.launch(launch);
    }, delayMs);
    this.timer.unref?.();
  }

  private backoff(): number {
    const delay = Math.min(
      this.timing.restartMinMs * 2 ** this.attempts,
      this.timing.restartMaxMs,
    );
    this.attempts += 1;
    return delay;
  }

  private async killChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    if (await waitForExit(child, this.timing.stopGraceMs)) return;
    child.kill("SIGKILL");
    await waitForExit(child, this.timing.stopGraceMs);
  }

  private setState(state: FrpcState, error: string | null): void {
    if (state !== this.state) this.since = Date.now();
    this.state = state;
    this.lastError = error;
    this.publish();
  }

  private publish(): void {
    const status = this.status();
    const key = JSON.stringify({ ...status, since: 0 });
    if (key === this.lastPublished) return;
    this.lastPublished = key;
    this.options.onStatusChange?.(status);
  }
}
