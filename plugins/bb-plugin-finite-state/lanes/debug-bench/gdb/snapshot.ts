import type { RtosTask } from "./rtos.js";
import type { DebugGdbSession, GdbSession, StackFrame } from "./session.js";

export interface TargetSnapshot {
  deviceId: string;
  takenAt: string;
  perturbation: { halted: boolean; haltMs: number | null };
  registers: Record<string, string>;
  frames: StackFrame[];
  tasks: RtosTask[];
  memoryRegions: Array<{ addr: string; bytes: number; artifactPath: string }>;
}

export interface SnapshotOptions {
  memoryRegions?: readonly { addr: string; bytes: number }[];
  writeMemoryArtifact?: (input: {
    deviceId: string;
    addr: string;
    bytes: Uint8Array;
    index: number;
  }) => Promise<string>;
  nonStop?: boolean;
  now?: () => Date;
  monotonicNowMs?: () => number;
}

function isDebugSession(session: GdbSession): session is DebugGdbSession {
  return "halt" in session && typeof session.halt === "function" &&
    "continue" in session && typeof session.continue === "function";
}

export async function snapshotTarget(
  session: GdbSession,
  options: SnapshotOptions = {},
): Promise<TargetSnapshot> {
  const regions = options.memoryRegions ?? [];
  if (regions.length > 64) throw new Error("SNAPSHOT_MEMORY_REGION_BOUND");
  for (const region of regions) {
    if (!Number.isInteger(region.bytes) || region.bytes < 1 || region.bytes > 64 * 1024) {
      throw new Error("SNAPSHOT_MEMORY_REGION_BOUND");
    }
  }
  if (regions.length > 0 && !options.writeMemoryArtifact) {
    throw new Error("SNAPSHOT_ARTIFACT_WRITER_REQUIRED");
  }

  const clock = options.monotonicNowMs ?? (() => performance.now());
  const canHalt = isDebugSession(session) && options.nonStop !== true;
  const haltStarted = canHalt ? clock() : null;
  let halted = false;
  let resumed = false;
  try {
    if (canHalt) {
      await session.halt();
      halted = true;
    }
    const [registers, frames, rtos] = await Promise.all([
      session.readRegisters(),
      session.backtrace(),
      session.rtosTasks(),
    ]);
    const memoryRegions: TargetSnapshot["memoryRegions"] = [];
    for (const [index, region] of regions.entries()) {
      const bytes = await session.readMemory(region.addr, region.bytes);
      const artifactPath = await options.writeMemoryArtifact!({
        deviceId: session.deviceId,
        addr: region.addr,
        bytes,
        index,
      });
      memoryRegions.push({ addr: region.addr, bytes: bytes.byteLength, artifactPath });
    }
    if (halted && isDebugSession(session)) {
      await session.continue();
      resumed = true;
    }
    const haltMs = halted && haltStarted !== null ? Math.max(0, clock() - haltStarted) : null;
    return {
      deviceId: session.deviceId,
      takenAt: (options.now ?? (() => new Date()))().toISOString(),
      perturbation: { halted, haltMs },
      registers,
      frames,
      tasks: rtos.tasks,
      memoryRegions,
    };
  } finally {
    if (halted && !resumed && isDebugSession(session)) await session.continue();
  }
}

export const captureGdbSnapshot = snapshotTarget;
