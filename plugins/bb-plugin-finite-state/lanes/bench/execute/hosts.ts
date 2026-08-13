import type { BbPluginApi } from "@bb/plugin-sdk";

export interface HostEnrollment {
  joinCode: string;
  hostId: string;
  expiresAt: string;
}

export interface BenchHost {
  id: string;
  name: string;
  connected: boolean;
  lastSeenAt: string | null;
}

export interface BenchHostCapabilities {
  allowPentest: boolean;
  docker: boolean;
  cveEvidenceVerifier: boolean;
  forgeCompute: boolean;
}

export interface BenchHostProbe {
  inspect(hostId: string, signal: AbortSignal): Promise<BenchHostCapabilities>;
}

function cancellableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export function createSdkBenchHostProbe(
  bb: BbPluginApi,
  input: { workspacePath: string; forgeCompute: boolean },
): BenchHostProbe {
  return {
    async inspect(hostId, signal) {
      const terminal = await bb.sdk.terminals.create({
        scope: { kind: "host_path", hostId, cwd: input.workspacePath },
        cols: 80,
        rows: 24,
        title: "Finite State bench preflight",
        start: {
          mode: "command",
          command: "/bin/sh -lc 'test \"$FORGE_ALLOW_PENTEST\" = 1 && echo FS_ALLOW=1; command -v docker >/dev/null 2>&1 && echo FS_DOCKER=1; command -v cve-evidence-verifier >/dev/null 2>&1 && echo FS_VERIFIER=1'",
        },
      });
      try {
        let session = terminal;
        for (let attempt = 0; attempt < 100 && session.status === "running"; attempt += 1) {
          await cancellableDelay(25, signal);
          session = await bb.sdk.terminals.get({ terminalId: terminal.id, signal });
        }
        if (session.status === "running") throw new Error("HOST_PREFLIGHT_TIMEOUT");
        const output = await bb.sdk.terminals.output({
          terminalId: terminal.id,
          tailBytes: 16_384,
          signal,
        });
        const text = output.chunks
          .map((chunk) => Buffer.from(chunk.dataBase64, "base64").toString("utf8"))
          .join("");
        return {
          allowPentest: text.includes("FS_ALLOW=1"),
          docker: text.includes("FS_DOCKER=1"),
          cveEvidenceVerifier: text.includes("FS_VERIFIER=1"),
          forgeCompute: input.forgeCompute,
        };
      } finally {
        await bb.sdk.terminals.close({ terminalId: terminal.id, mode: "force" });
      }
    },
  };
}

export type BenchHostPrerequisite = keyof BenchHostCapabilities;

export interface SelectedBenchHost {
  host: BenchHost;
  capabilities: BenchHostCapabilities;
}

export class BenchHostError extends Error {
  constructor(
    readonly code: "HOST_NOT_ENROLLED" | "HOST_DISCONNECTED" | "HOST_PREREQUISITES_MISSING",
    message: string,
    readonly missing: readonly BenchHostPrerequisite[] = [],
  ) {
    super(message);
    this.name = "BenchHostError";
  }
}

/**
 * Human-facing enrollment. The returned code is deliberately not retained;
 * the target must run bb host-daemon and redeem it before it can be selected.
 */
export async function createBenchHostJoinCode(bb: BbPluginApi): Promise<HostEnrollment> {
  const enrollment = await bb.sdk.hosts.createJoinCode();
  return {
    joinCode: enrollment.joinCode,
    hostId: enrollment.hostId,
    expiresAt: new Date(enrollment.expiresAt).toISOString(),
  };
}

export async function listBenchHosts(
  bb: BbPluginApi,
  signal?: AbortSignal,
): Promise<BenchHost[]> {
  const hosts = await bb.sdk.hosts.list({ ...(signal ? { signal } : {}) });
  return hosts.map((host) => ({
    id: host.id,
    name: host.name,
    connected: host.status === "connected",
    lastSeenAt: host.lastSeenAt === null ? null : new Date(host.lastSeenAt).toISOString(),
  }));
}

export async function selectBenchHost(
  bb: BbPluginApi,
  probe: BenchHostProbe,
  hostId: string,
  required: readonly BenchHostPrerequisite[],
  signal: AbortSignal,
): Promise<SelectedBenchHost> {
  signal.throwIfAborted();
  const host = (await listBenchHosts(bb, signal)).find((candidate) => candidate.id === hostId);
  if (!host) {
    throw new BenchHostError(
      "HOST_NOT_ENROLLED",
      `Bench host ${hostId} is not enrolled. Run bb host-daemon on the target and redeem a join code.`,
    );
  }
  if (!host.connected) {
    throw new BenchHostError(
      "HOST_DISCONNECTED",
      `Bench host ${host.name} is enrolled but its host-daemon is disconnected.`,
    );
  }
  const capabilities = required.length === 0
    ? {
        allowPentest: false,
        docker: false,
        cveEvidenceVerifier: false,
        forgeCompute: false,
      }
    : await probe.inspect(host.id, signal);
  const missing = required.filter((name) => capabilities[name] !== true);
  if (missing.length > 0) {
    const labels: Record<BenchHostPrerequisite, string> = {
      allowPentest: "FORGE_ALLOW_PENTEST=1",
      docker: "Docker",
      cveEvidenceVerifier: "cve-evidence-verifier",
      forgeCompute: "configured Forge Compute",
    };
    throw new BenchHostError(
      "HOST_PREREQUISITES_MISSING",
      `Bench host ${host.name} is missing: ${missing.map((name) => labels[name]).join(", ")}.`,
      missing,
    );
  }
  return { host, capabilities };
}

export async function startBenchThread(
  bb: BbPluginApi,
  input: {
    projectId: string;
    pvId: string;
    tier: "tier0" | "tier1";
    hostId: string;
    workspacePath: string;
    firmwareDigest: string;
  },
): Promise<string> {
  const thread = await bb.sdk.threads.spawn({
    projectId: input.projectId,
    title: `Bench ${input.tier}: ${input.pvId}`,
    visibility: "hidden",
    environment: {
      type: "host",
      hostId: input.hostId,
      workspace: { type: "unmanaged", path: input.workspacePath },
    },
    prompt: [
      "Run the Finite State verification bench action already queued by the server.",
      `Tier: ${input.tier}`,
      `Project version: ${input.pvId}`,
      `Prepared firmware digest: ${input.firmwareDigest}`,
      "Do not modify authored project files.",
    ].join("\n"),
  });
  return thread.id;
}
