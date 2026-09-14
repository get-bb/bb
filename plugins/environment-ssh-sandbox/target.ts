import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

export const DESTINATION_PATTERN =
  /^(?:[A-Za-z0-9._-]+@)?(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+)$/;

export const sshMachineInputsSchema = z
  .object({
    destination: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(
        DESTINATION_PATTERN,
        "destination must be an SSH alias, hostname, user@host, or user@[IPv6]",
      ),
    port: z.number().int().min(1).max(65535).optional(),
  })
  .strict();

export type SshMachineInputs = z.infer<typeof sshMachineInputsSchema>;

export const sshMachineResourceSchema = z
  .object({
    destination: sshMachineInputsSchema.shape.destination,
    port: sshMachineInputsSchema.shape.port,
  })
  .strict();

export type SshMachineResource = z.infer<typeof sshMachineResourceSchema>;

export const KNOWN_HOSTS_OPTIONS = ["accept-new", "yes", "no"] as const;
export type KnownHostsMode = (typeof KNOWN_HOSTS_OPTIONS)[number];

export interface ResolvedSshSettings {
  identityFile: string | null;
  knownHosts: KnownHostsMode;
  connectTimeoutSeconds: number;
}

export interface RawSshSettings {
  identityFile: string;
  knownHosts: string;
  connectTimeoutSeconds: number;
}

export function resolveIdentityFile(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes("\0") || /[\n\r]/.test(trimmed)) {
    throw new Error("identityFile must be a single filesystem path.");
  }
  if (trimmed.startsWith("-")) {
    throw new Error("identityFile must be a filesystem path.");
  }
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return path.join(homedir(), trimmed.slice(2));
  return trimmed;
}

export function resolveSshSettings(raw: RawSshSettings): ResolvedSshSettings {
  if (!KNOWN_HOSTS_OPTIONS.includes(raw.knownHosts as KnownHostsMode)) {
    throw new Error(
      `knownHosts must be one of ${KNOWN_HOSTS_OPTIONS.join(", ")}.`,
    );
  }
  if (
    !Number.isInteger(raw.connectTimeoutSeconds) ||
    raw.connectTimeoutSeconds < 1 ||
    raw.connectTimeoutSeconds > 120
  ) {
    throw new Error(
      "connectTimeoutSeconds must be a whole number between 1 and 120.",
    );
  }
  return {
    identityFile: resolveIdentityFile(raw.identityFile),
    knownHosts: raw.knownHosts as KnownHostsMode,
    connectTimeoutSeconds: raw.connectTimeoutSeconds,
  };
}

export interface SshTarget extends SshMachineResource, ResolvedSshSettings {
  sshPath: string;
}

export function displayTarget(resource: SshMachineResource): string {
  return resource.port === undefined
    ? resource.destination
    : `${resource.destination}:${resource.port}`;
}
