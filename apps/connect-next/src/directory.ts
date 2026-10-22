export interface TunnelProxy {
  label: string;
  subdomain: string;
  clientId: string;
}

export type TunnelLocation =
  | { kind: "here" }
  | { kind: "elsewhere"; instance: string }
  | { kind: "offline" };

export interface LookupOptions {
  signal: AbortSignal;
  fresh: boolean;
}

export type LabelPresence = "connected" | "disconnected";

export interface TunnelDirectory {
  connected(proxy: TunnelProxy): void;
  disconnected(proxy: TunnelProxy): void;
  removed(subdomain: string): void;
  locate(subdomain: string): TunnelLocation;
  lookup(subdomain: string, options: LookupOptions): Promise<TunnelLocation>;
  awaitReturn(subdomain: string, signal: AbortSignal): Promise<TunnelLocation>;
  onlineLabels(): string[];
  onLabelPresence(
    listener: (label: string, state: LabelPresence) => void,
  ): void;
}

export const TUNNEL_RETURN_GRACE_MS = 15_000;

export function labelOf(subdomain: string): string {
  const separator = subdomain.indexOf("--");
  return separator === -1 ? subdomain : subdomain.slice(0, separator);
}

export interface LocalDirectoryOptions {
  graceMs?: number;
  now?: () => number;
}

export function createLocalDirectory(
  options: LocalDirectoryOptions = {},
): TunnelDirectory {
  const graceMs = options.graceMs ?? TUNNEL_RETURN_GRACE_MS;
  const now = options.now ?? Date.now;
  const clients = new Map<string, Set<string>>();
  const lostAt = new Map<string, number>();
  const waiters = new Map<string, Set<() => void>>();
  const listeners: ((label: string, state: LabelPresence) => void)[] = [];

  const subdomainsByLabel = new Map<string, Set<string>>();

  function online(subdomain: string): boolean {
    return (clients.get(subdomain)?.size ?? 0) > 0;
  }

  function held(label: string): boolean {
    return (subdomainsByLabel.get(label)?.size ?? 0) > 0;
  }

  function wake(subdomain: string): void {
    for (const settle of [...(waiters.get(subdomain) ?? [])]) settle();
  }

  function announce(label: string, state: LabelPresence): void {
    for (const listener of listeners) listener(label, state);
  }

  return {
    connected(proxy) {
      const wasHeld = held(proxy.label);
      const set = clients.get(proxy.subdomain) ?? new Set<string>();
      set.add(proxy.clientId);
      clients.set(proxy.subdomain, set);
      const subdomains =
        subdomainsByLabel.get(proxy.label) ?? new Set<string>();
      subdomains.add(proxy.subdomain);
      subdomainsByLabel.set(proxy.label, subdomains);
      lostAt.delete(proxy.subdomain);
      wake(proxy.subdomain);
      if (!wasHeld) announce(proxy.label, "connected");
    },
    disconnected(proxy) {
      const set = clients.get(proxy.subdomain);
      if (set === undefined || !set.delete(proxy.clientId)) return;
      if (set.size > 0) return;
      clients.delete(proxy.subdomain);
      lostAt.set(proxy.subdomain, now());
      const subdomains = subdomainsByLabel.get(proxy.label);
      subdomains?.delete(proxy.subdomain);
      if (subdomains !== undefined && subdomains.size === 0) {
        subdomainsByLabel.delete(proxy.label);
        announce(proxy.label, "disconnected");
      }
    },
    removed(subdomain) {
      if (online(subdomain) || !lostAt.has(subdomain)) return;
      lostAt.delete(subdomain);
      wake(subdomain);
    },
    locate(subdomain) {
      return online(subdomain) ? { kind: "here" } : { kind: "offline" };
    },
    async lookup(subdomain) {
      return online(subdomain) ? { kind: "here" } : { kind: "offline" };
    },
    async awaitReturn(subdomain, signal) {
      if (online(subdomain)) return { kind: "here" };
      const label = labelOf(subdomain);
      if (subdomain !== label && held(label)) {
        lostAt.delete(subdomain);
        return { kind: "offline" };
      }
      const lost = lostAt.get(subdomain);
      const remaining = lost === undefined ? 0 : lost + graceMs - now();
      if (remaining <= 0) {
        lostAt.delete(subdomain);
        return { kind: "offline" };
      }
      await new Promise<void>((resolve) => {
        const set = waiters.get(subdomain) ?? new Set<() => void>();
        waiters.set(subdomain, set);
        const settle = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", settle);
          set.delete(settle);
          if (set.size === 0) waiters.delete(subdomain);
          resolve();
        };
        const timer = setTimeout(settle, remaining);
        signal.addEventListener("abort", settle);
        set.add(settle);
      });
      return online(subdomain) ? { kind: "here" } : { kind: "offline" };
    },
    onlineLabels() {
      return [...subdomainsByLabel.keys()];
    },
    onLabelPresence(listener) {
      listeners.push(listener);
    },
  };
}
