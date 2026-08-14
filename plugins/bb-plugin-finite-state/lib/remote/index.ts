import type { PluginContext } from "../context.js";
import { AssuranceStudioClient } from "./assurance-studio/client.js";
import {
  assuranceStudioConfigChanged,
  forgeConfigChanged,
  platformConfigChanged,
  readRemoteConfig,
  type RemoteConfig,
  type RemoteSettingValues,
} from "./config.js";
import {
  connectionStatusMessage,
  diagnoseRemoteFailure,
  settingsFailureDiagnostic,
  unavailableError,
  type RemoteFailureDiagnostic,
} from "./errors.js";
import { ForgeComputeClient } from "./forge-compute/client.js";
import { createForgeMcpTransport } from "./forge-compute/mcp-transport.js";
import { PlatformClient } from "./platform/client.js";
import type {
  AsCreatableEntityKind,
  AsEntityKind,
  AssuranceStudioClient as AssuranceStudioClientContract,
  FirmwareFileByteRequest,
  FirmwareFileMetadataRequest,
  ForgeComputeClient as ForgeComputeClientContract,
  ForgeJobStatus,
  ForgePenTestInput,
  Json,
  PlatformClient as PlatformClientContract,
  RemoteArtifact,
  RemoteCallContext,
  RemotePageRequest,
  RemoteServices,
  SecurityAssessmentRequest,
  VexDecisionInput,
  VexInput,
} from "./types.js";

export type ConnectionState =
  | "needs-configuration"
  | "disabled"
  | "configured"
  | "connected"
  | "unreachable";
export interface ConnectionStatus {
  state: ConnectionState;
  message: string | null;
  checkedAt: string | null;
}
export interface RemoteConnectionStatus {
  platform: ConnectionStatus;
  assuranceStudio: ConnectionStatus;
  forgeCompute: ConnectionStatus;
}
export interface RemoteConnectionDiagnostics {
  platform: RemoteFailureDiagnostic | null;
  assuranceStudio: RemoteFailureDiagnostic | null;
  forgeCompute: RemoteFailureDiagnostic | null;
}

export interface RemoteServiceController {
  readonly services: RemoteServices;
  reconfigure(
    next: RemoteSettingValues,
    prev: RemoteSettingValues,
  ): Promise<void>;
  connectionStatus(): RemoteConnectionStatus;
  connectionDiagnostics(): RemoteConnectionDiagnostics;
  dispose(): Promise<void>;
}

interface Slot<Client> {
  client: Client | null;
  close: () => void | Promise<void>;
  abort: AbortController;
  status: ConnectionStatus;
  diagnostic: RemoteFailureDiagnostic | null;
  generation: number;
}

function unavailable(): never {
  throw unavailableError("platform");
}
function unavailableAs(): never {
  throw unavailableError("assurance-studio");
}
function unavailableForge(): never {
  throw unavailableError("forge-compute");
}

class PlatformDelegate implements PlatformClientContract {
  constructor(private readonly current: () => PlatformClientContract | null) {}
  health(ctx?: RemoteCallContext) {
    return this.current()?.health(ctx) ?? unavailable();
  }
  listProjects(page?: RemotePageRequest, ctx?: RemoteCallContext) {
    return this.current()?.listProjects(page, ctx) ?? unavailable();
  }
  listVersions(id: string, page?: RemotePageRequest, ctx?: RemoteCallContext) {
    return this.current()?.listVersions(id, page, ctx) ?? unavailable();
  }
  getFindings(
    input: { projectVersionId: string; page?: RemotePageRequest },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.getFindings(input, ctx) ?? unavailable();
  }
  getFindingDetail(
    input: { projectVersionId: string; findingId: string },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.getFindingDetail(input, ctx) ?? unavailable();
  }
  getFindingActivity(
    input: {
      projectId: string;
      projectVersionId: string;
      cve: string;
      page?: RemotePageRequest;
    },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.getFindingActivity(input, ctx) ?? unavailable();
  }
  listFindingComments(
    input: {
      projectVersionId: string;
      findingId: string;
      page?: RemotePageRequest;
    },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.listFindingComments(input, ctx) ?? unavailable();
  }
  getFindingsSummary(id: string, ctx?: RemoteCallContext) {
    return this.current()?.getFindingsSummary(id, ctx) ?? unavailable();
  }
  setVexStatus(input: VexInput, ctx?: RemoteCallContext) {
    return this.current()?.setVexStatus(input, ctx) ?? unavailable();
  }
  batchSetVexStatus(
    input: { projectVersionId: string; findings: VexDecisionInput[] },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.batchSetVexStatus(input, ctx) ?? unavailable();
  }
  clearVexStatus(
    input: { projectVersionId: string; findingIds: string[] },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.clearVexStatus(input, ctx) ?? unavailable();
  }
  downloadSbom(
    input: {
      projectVersionId: string;
      format: "cyclonedx" | "spdx";
      includeVex: boolean;
    },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.downloadSbom(input, ctx) ?? unavailable();
  }
  listComponents(
    input: {
      filter?: string;
      excluded?: boolean;
      sort?: string;
      page?: RemotePageRequest;
      editStatus?: "any" | "edited" | "unedited";
    },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.listComponents(input, ctx) ?? unavailable();
  }
  searchComponents(
    input: {
      name: string;
      version?: string;
      page?: RemotePageRequest;
      sort?: string;
    },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.searchComponents(input, ctx) ?? unavailable();
  }
  browseFirmwareFilesystem(
    input: {
      projectVersionId: string;
      path?: string;
      depth?: number;
      fileHash?: string;
      scanId?: string;
    },
    ctx?: RemoteCallContext,
  ) {
    return (
      this.current()?.browseFirmwareFilesystem(input, ctx) ?? unavailable()
    );
  }
  getFirmwareFile(
    input: FirmwareFileMetadataRequest,
    ctx?: RemoteCallContext,
  ): Promise<Record<string, Json>>;
  getFirmwareFile(
    input: FirmwareFileByteRequest,
    ctx?: RemoteCallContext,
  ): Promise<RemoteArtifact>;
  getFirmwareFile(
    input: FirmwareFileMetadataRequest | FirmwareFileByteRequest,
    ctx?: RemoteCallContext,
  ): Promise<Record<string, Json> | RemoteArtifact> {
    const client = this.current();
    if (!client) return unavailable();
    return input.mode === "meta"
      ? client.getFirmwareFile(input, ctx)
      : client.getFirmwareFile(input, ctx);
  }
  securityAssessment(
    input: SecurityAssessmentRequest,
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.securityAssessment(input, ctx) ?? unavailable();
  }
}

class AssuranceStudioDelegate implements AssuranceStudioClientContract {
  constructor(
    private readonly current: () => AssuranceStudioClientContract | null,
  ) {}
  health(ctx?: RemoteCallContext) {
    return this.current()?.health(ctx) ?? unavailableAs();
  }
  listProjectLinks(
    input: { platformProjectId: string; page?: RemotePageRequest },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.listProjectLinks(input, ctx) ?? unavailableAs();
  }
  listEntities(
    kind: AsEntityKind,
    input: {
      projectId: string;
      page?: RemotePageRequest;
      filters?: Record<string, Json>;
    },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.listEntities(kind, input, ctx) ?? unavailableAs();
  }
  getEntity(
    kind: AsEntityKind,
    input: { projectId: string; id: string },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.getEntity(kind, input, ctx) ?? unavailableAs();
  }
  createEntity(
    kind: AsCreatableEntityKind,
    input: { projectId: string; fields: Record<string, Json> },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.createEntity(kind, input, ctx) ?? unavailableAs();
  }
  updateEntity(
    kind: AsEntityKind,
    input: {
      projectId: string;
      id: string;
      fields: Record<string, Json>;
      force?: boolean;
    },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.updateEntity(kind, input, ctx) ?? unavailableAs();
  }
  deleteEntity(
    kind: AsEntityKind,
    input: {
      projectId: string;
      id: string;
      mode?: "cascade" | "detach";
      force?: boolean;
    },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.deleteEntity(kind, input, ctx) ?? unavailableAs();
  }
  listProjectSbomPackages(
    input: {
      projectId: string;
      page?: RemotePageRequest;
      filters?: Record<string, Json>;
    },
    ctx?: RemoteCallContext,
  ) {
    return (
      this.current()?.listProjectSbomPackages(input, ctx) ?? unavailableAs()
    );
  }
  listVerificationChecks(
    input: {
      projectId: string;
      status?: string;
      type?: string;
      requirementId?: string;
      page?: RemotePageRequest;
    },
    ctx?: RemoteCallContext,
  ) {
    return (
      this.current()?.listVerificationChecks(input, ctx) ?? unavailableAs()
    );
  }
  getVerificationCheck(
    input: { projectId: string; checkId: string },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.getVerificationCheck(input, ctx) ?? unavailableAs();
  }
  runVerificationChecks(
    input: { projectId: string; checkIds?: string[]; rerunPassed?: boolean },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.runVerificationChecks(input, ctx) ?? unavailableAs();
  }
}

class ForgeDelegate implements ForgeComputeClientContract {
  constructor(
    private readonly current: () => ForgeComputeClientContract | null,
  ) {}
  health(ctx?: RemoteCallContext) {
    return this.current()?.health(ctx) ?? unavailableForge();
  }
  verifyDynamic(
    input: {
      projectVersionId: string;
      verdictIds: string[];
      budgetSecPerVerdict?: number;
    },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.verifyDynamic(input, ctx) ?? unavailableForge();
  }
  penTestRun(input: ForgePenTestInput, ctx?: RemoteCallContext) {
    return this.current()?.penTestRun(input, ctx) ?? unavailableForge();
  }
  getJobStatus(jobId: string, tailLines?: number, ctx?: RemoteCallContext) {
    return (
      this.current()?.getJobStatus(jobId, tailLines, ctx) ?? unavailableForge()
    );
  }
  listJobs(
    input?: {
      status?: ForgeJobStatus;
      tool?: string;
      page?: RemotePageRequest;
    },
    ctx?: RemoteCallContext,
  ) {
    return this.current()?.listJobs(input, ctx) ?? unavailableForge();
  }
  watchJob(jobId: string, ctx?: RemoteCallContext) {
    return this.current()?.watchJob(jobId, ctx) ?? unavailableForge();
  }
}

function originLabel(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.host.length > 0
    );
  } catch {
    return false;
  }
}

function emptySlot<Client>(status: ConnectionStatus): Slot<Client> {
  return {
    client: null,
    close: () => undefined,
    abort: new AbortController(),
    status,
    diagnostic: null,
    generation: 0,
  };
}

export function createRemoteServiceController(
  ctx: PluginContext,
  initial: RemoteSettingValues,
): RemoteServiceController {
  let disposed = false;
  let publishForgeHint:
    | ((hint: {
        jobId: string;
        status: ForgeJobStatus;
        eventCount: number;
      }) => void)
    | null = (hint) => ctx.bb.realtime.publish("fs-forge-job", hint);
  let config = readRemoteConfig(initial);
  let platform = emptySlot<PlatformClientContract>({
    state: "needs-configuration",
    message: "Connect your Finite State account to load projects",
    checkedAt: null,
  });
  let assuranceStudio = emptySlot<AssuranceStudioClientContract>({
    state: "disabled",
    message: "Assurance Studio is not configured",
    checkedAt: null,
  });
  let forge = emptySlot<ForgeComputeClientContract>({
    state: "disabled",
    message: "Forge Compute is disabled",
    checkedAt: null,
  });
  const platformDelegate = new PlatformDelegate(() => platform.client);
  const assuranceStudioDelegate = new AssuranceStudioDelegate(
    () => assuranceStudio.client,
  );
  const forgeDelegate = new ForgeDelegate(() => forge.client);
  const services: RemoteServices = {
    platform: platformDelegate,
    assuranceStudio: assuranceStudioDelegate,
    get forgeCompute() {
      return config.forgeTransport === "disabled" ? null : forgeDelegate;
    },
  };

  const probe = async <
    Client extends { health(ctx?: RemoteCallContext): Promise<unknown> },
  >(
    slot: Slot<Client>,
    service: "Platform" | "Assurance Studio" | "Forge Compute",
    label: string | null,
  ) => {
    const generation = slot.generation;
    try {
      await slot.client?.health({ signal: slot.abort.signal });
      if (!disposed && slot.generation === generation) slot.diagnostic = null;
      if (!disposed && slot.generation === generation)
        slot.status = {
          state: "connected",
          message:
            label === null
              ? `${service} is connected`
              : `${service} at ${label} is connected`,
          checkedAt: new Date().toISOString(),
        };
    } catch (error: unknown) {
      if (
        !disposed &&
        slot.generation === generation &&
        !slot.abort.signal.aborted
      ) {
        const diagnostic = diagnoseRemoteFailure(error);
        slot.diagnostic = diagnostic;
        slot.status = {
          state: "unreachable",
          message: connectionStatusMessage(diagnostic),
          checkedAt: new Date().toISOString(),
        };
      }
    }
  };

  const configurePlatform = (next: RemoteConfig) => {
    const old = platform;
    old.abort.abort();
    void old.close();
    if (next.platformBaseUrl === null || next.platformToken === null) {
      platform = emptySlot({
        state: "needs-configuration",
        message: "Connect your Finite State account to load projects",
        checkedAt: null,
      });
      return;
    }
    let client: PlatformClient;
    try {
      if (!isAbsoluteHttpUrl(next.platformBaseUrl))
        throw new TypeError("invalid URL");
      client = new PlatformClient({
        baseUrl: next.platformBaseUrl,
        token: next.platformToken,
        concurrency: next.platformConcurrency,
      });
    } catch {
      const message =
        "Platform URL (platformBaseUrl) is malformed. Enter an absolute HTTP(S) URL in connection settings.";
      platform = emptySlot({
        state: "needs-configuration",
        message,
        checkedAt: new Date().toISOString(),
      });
      platform.diagnostic = settingsFailureDiagnostic("platform", message);
      platform.generation = old.generation + 1;
      return;
    }
    platform = {
      client,
      close: () => client.close(),
      abort: new AbortController(),
      status: {
        state: "configured",
        message: `Platform at ${originLabel(next.platformBaseUrl) ?? "configured origin"} is configured`,
        checkedAt: null,
      },
      diagnostic: null,
      generation: old.generation + 1,
    };
    void probe(platform, "Platform", originLabel(next.platformBaseUrl));
  };

  const configureAs = (next: RemoteConfig) => {
    const old = assuranceStudio;
    old.abort.abort();
    void old.close();
    if (next.asBaseUrl === null || next.asApiKey === null) {
      assuranceStudio = emptySlot({
        state: "disabled",
        message: "Assurance Studio is not configured",
        checkedAt: null,
      });
      return;
    }
    let client: AssuranceStudioClient;
    try {
      if (!isAbsoluteHttpUrl(next.asBaseUrl))
        throw new TypeError("invalid URL");
      client = new AssuranceStudioClient({
        baseUrl: next.asBaseUrl,
        apiKey: next.asApiKey,
        concurrency: next.asConcurrency,
      });
    } catch {
      const message =
        "Assurance Studio URL (asBaseUrl) is malformed. Enter an absolute HTTP(S) URL in connection settings.";
      assuranceStudio = emptySlot({
        state: "needs-configuration",
        message,
        checkedAt: new Date().toISOString(),
      });
      assuranceStudio.diagnostic = settingsFailureDiagnostic(
        "assurance-studio",
        message,
      );
      assuranceStudio.generation = old.generation + 1;
      return;
    }
    assuranceStudio = {
      client,
      close: () => client.close(),
      abort: new AbortController(),
      status: {
        state: "configured",
        message: `Assurance Studio at ${originLabel(next.asBaseUrl) ?? "configured origin"} is configured`,
        checkedAt: null,
      },
      diagnostic: null,
      generation: old.generation + 1,
    };
    void probe(
      assuranceStudio,
      "Assurance Studio",
      originLabel(next.asBaseUrl),
    );
  };

  const configureForge = async (next: RemoteConfig) => {
    const old = forge;
    old.abort.abort();
    await old.close();
    if (next.forgeTransport === "disabled") {
      forge = emptySlot({
        state: "disabled",
        message: "Forge Compute is disabled",
        checkedAt: null,
      });
      return;
    }
    const generation = old.generation + 1;
    const pending = emptySlot<ForgeComputeClientContract>({
      state: "configured",
      message: `Forge Compute over ${next.forgeTransport} is configured`,
      checkedAt: null,
    });
    pending.generation = generation;
    forge = pending;
    try {
      const transport = await createForgeMcpTransport(next);
      if (disposed || forge.generation !== generation) {
        await transport.close();
        return;
      }
      const client = new ForgeComputeClient({
        transport,
        concurrency: next.forgeConcurrency,
        remoteTransport: next.forgeTransport !== "stdio",
        publishHint: (hint) => publishForgeHint?.(hint),
      });
      forge.client = client;
      forge.close = () => client.close();
      void probe(forge, "Forge Compute", next.forgeTransport);
    } catch {
      if (!disposed && forge.generation === generation)
        forge.status = {
          state: "unreachable",
          message: `Forge Compute over ${next.forgeTransport} is unreachable`,
          checkedAt: new Date().toISOString(),
        };
    }
  };

  configurePlatform(config);
  configureAs(config);
  void configureForge(config);

  return {
    services,
    async reconfigure(next, prev) {
      if (disposed) return;
      const nextConfig = readRemoteConfig(next);
      config = nextConfig;
      if (platformConfigChanged(next, prev)) configurePlatform(nextConfig);
      if (assuranceStudioConfigChanged(next, prev)) configureAs(nextConfig);
      if (forgeConfigChanged(next, prev)) await configureForge(nextConfig);
    },
    connectionStatus() {
      return {
        platform: { ...platform.status },
        assuranceStudio: { ...assuranceStudio.status },
        forgeCompute: { ...forge.status },
      };
    },
    connectionDiagnostics() {
      return {
        platform: platform.diagnostic,
        assuranceStudio: assuranceStudio.diagnostic,
        forgeCompute: forge.diagnostic,
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      publishForgeHint = null;
      platform.abort.abort();
      assuranceStudio.abort.abort();
      forge.abort.abort();
      await Promise.all([
        platform.close(),
        assuranceStudio.close(),
        forge.close(),
      ]);
    },
  };
}

export type { RemoteSettingValues } from "./config.js";
