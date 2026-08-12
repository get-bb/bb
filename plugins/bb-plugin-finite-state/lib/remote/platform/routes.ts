import type { SecurityAssessmentTool } from "../types.js";

export type RetryClass = "safe" | "idempotent" | "write-once";

export interface PlatformRoute {
  readonly method: "GET" | "PUT";
  readonly path: string;
  readonly operationId: string;
  readonly requestMediaType: "application/json" | null;
  readonly responseMediaType: "application/json" | "application/octet-stream";
  readonly retry: RetryClass;
}

export const PLATFORM_ROUTES = {
  health: { method: "GET", path: "/public/v0/projects", operationId: "getProjectsV0", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  listProjects: { method: "GET", path: "/public/v0/projects", operationId: "getProjectsV0", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  listVersions: { method: "GET", path: "/public/v0/projects/{projectId}/versions", operationId: "getVersionsV0ForProject", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  getFindings: { method: "GET", path: "/public/v0/versions/{projectVersionId}/findings", operationId: "getFindingsForVersion", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  getFindingDetail: { method: "GET", path: "/public/v0/findings", operationId: "getFindingsV0", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  getFindingActivity: { method: "GET", path: "/public/v0/projects/{projectId}/findings/activity", operationId: "getFindingActivityV0", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  listFindingComments: { method: "GET", path: "/public/v0/findings", operationId: "getFindingsV0", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  getExploitCounts: { method: "GET", path: "/public/v0/project/version/{projectVersionId}/findings/exploit/counts", operationId: "getExploitCounts", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  getStatusCounts: { method: "GET", path: "/public/v0/project/version/{projectVersionId}/findings/status/counts", operationId: "getStatusCounts", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  getCategoryCounts: { method: "GET", path: "/public/v0/project/version/{projectVersionId}/findings/category/counts", operationId: "getCategoryCounts", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  getSeverityCounts: { method: "GET", path: "/public/v0/project/version/{projectVersionId}/findings/severities/counts", operationId: "getSeverityCounts", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  setVexStatus: { method: "PUT", path: "/public/v0/findings/{projectVersionId}/{findingId}/status", operationId: "updateFindingStatusV0", requestMediaType: "application/json", responseMediaType: "application/json", retry: "write-once" },
  batchSetVexStatus: { method: "PUT", path: "/public/v0/findings/{projectVersionId}/status/set/bulk", operationId: "bulkSetFindingStatusV0", requestMediaType: "application/json", responseMediaType: "application/json", retry: "write-once" },
  clearVexStatus: { method: "PUT", path: "/public/v0/findings/{projectVersionId}/status/clear/bulk", operationId: "bulkClearFindingStatusV0", requestMediaType: "application/json", responseMediaType: "application/json", retry: "write-once" },
  downloadCycloneDx: { method: "GET", path: "/public/v0/sboms/cyclonedx/{projectVersionId}", operationId: "getSbomCdx", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  downloadSpdx: { method: "GET", path: "/public/v0/sboms/spdx/{projectVersionId}", operationId: "getSbomSpdx", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  listComponents: { method: "GET", path: "/public/v0/components", operationId: "getComponentsV0", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  searchComponents: { method: "GET", path: "/public/v0/components/search", operationId: "searchComponentsV0", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  browseFirmwareFilesystem: { method: "GET", path: "/public/v0/projects/versions/{projectVersionId}/filesystem/tree", operationId: "getFilesystemTree", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  getFirmwareMetadata: { method: "GET", path: "/public/v0/projects/versions/{projectVersionId}/filesystem/overview", operationId: "getFilesystemOverview", requestMediaType: null, responseMediaType: "application/json", retry: "safe" },
  getFirmwareRange: { method: "GET", path: "/public/v0/projects/versions/{projectVersionId}/filesystem/content", operationId: "getFilesystemContent", requestMediaType: null, responseMediaType: "application/octet-stream", retry: "safe" },
  getFirmwareFile: { method: "GET", path: "/public/v0/projects/versions/{projectVersionId}/filesystem/file", operationId: "getFilesystemFile", requestMediaType: null, responseMediaType: "application/octet-stream", retry: "safe" },
} as const satisfies Record<string, PlatformRoute>;

export const SECURITY_ASSESSMENT_ROUTES = {
  stp_callgraph: ["callgraph/callers", "getSecurityAssessmentCallgraphCallers"],
  stp_find_binaries_with_symbols: ["binaries/has-exports", "getSecurityAssessmentBinaryHasExports"],
  stp_elf_dependency_graph: ["dependencies/loads", "getSecurityAssessmentDependencyLoads"],
  stp_binary_details: ["binaries/info", "getSecurityAssessmentBinaryInfo"],
  stp_kernel_config: ["kernel/config", "getSecurityAssessmentKernelConfig"],
  get_scan_quality: ["processing-errors", "getSecurityAssessmentProcessingErrors"],
  stp_architecture: ["architecture", "getSecurityAssessmentArchitecture"],
  stp_configs: ["configs/list", "listSecurityAssessmentConfigs"],
  stp_services: ["services/list", "listSecurityAssessmentServices"],
  stp_crypto: ["crypto/list", "listSecurityAssessmentCrypto"],
} as const satisfies Record<SecurityAssessmentTool, readonly [string, string]>;
