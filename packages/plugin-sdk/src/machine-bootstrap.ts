import type {
  ServerAccessGrant,
  ServerAccessSelection,
} from "./backend-contract.js";
import type { PluginMachineProviderProgress } from "./machine-provider.js";

export interface EnrollmentBootstrap {
  version: 1;
  hostId: string;
  serverUrl: string;
  client: ServerAccessGrant["client"];
  credential: string;
  expiresAt: number;
}

export type MachineEnrollment =
  | {
      id: string;
      hostId: string;
      state: "pending";
      bootstrap: EnrollmentBootstrap;
      expiresAt: number;
    }
  | { id: string; hostId: string; state: "enrolled" };

export interface MachineExecutorRequest {
  command: string[];
  timeoutMs: number;
  signal: AbortSignal;
  stdin?: string;
}

export interface MachineExecutor {
  exec(
    request: MachineExecutorRequest,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  writeFile?(path: string, contents: string, mode?: number): Promise<void>;
}

export interface MachineEnrollmentRequest {
  key: string;
  access?: ServerAccessSelection;
}

export interface MachineConnectionRequest {
  enrollmentId: string;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface MachineEnrollments {
  prepare(request: MachineEnrollmentRequest): Promise<MachineEnrollment>;
  waitForConnection(
    request: MachineConnectionRequest,
  ): Promise<{ hostId: string }>;
  cancel(request: { enrollmentId: string }): Promise<void>;
}

export interface MachineBootstrapRequest extends MachineEnrollmentRequest {
  executor: MachineExecutor;
  daemon: { kind: "preinstalled" } | { kind: "install" };
  report: PluginMachineProviderProgress;
  signal: AbortSignal;
}

export interface MachineInstallerCommand {
  command: string[];
  stdin: string;
}

export interface MachineBootstrapApi {
  enrollments: MachineEnrollments;
  prepareEnrollment(
    request: MachineEnrollmentRequest,
  ): Promise<MachineEnrollment>;
  waitForConnection(
    request: MachineConnectionRequest,
  ): Promise<{ hostId: string }>;
  installerCommand(bootstrap: EnrollmentBootstrap): MachineInstallerCommand;
  bootstrap(request: MachineBootstrapRequest): Promise<{ hostId: string }>;
}
