import {
  SECURITY_ASSESSMENT_TOOLS,
  type Json,
  type SecurityAssessmentTool,
} from "../../../lib/remote/types.js";
import type { MockHandlerRegistry } from "../types.js";

export const MOCK_SECURITY_ASSESSMENT_ROUTES = {
  stp_callgraph: "callgraph/callers",
  stp_find_binaries_with_symbols: "binaries/has-exports",
  stp_elf_dependency_graph: "dependencies/loads",
  stp_binary_details: "binaries/info",
  stp_kernel_config: "kernel/config",
  get_scan_quality: "processing-errors",
  stp_architecture: "architecture",
  stp_configs: "configs/list",
  stp_services: "services/list",
  stp_crypto: "crypto/list",
} as const satisfies Record<SecurityAssessmentTool, string>;

function fixture(
  tool: SecurityAssessmentTool,
  projectVersionId: string,
  scanId: string | null,
  params: Record<string, Json>,
): Json {
  return {
    projectVersionId,
    scanId,
    tool,
    params,
    data: [{ id: `${tool}-fixture`, deterministic: true }],
  };
}

export function registerMockPlatformSecurityAssessment(registry: MockHandlerRegistry): void {
  for (const tool of SECURITY_ASSESSMENT_TOOLS) {
    const suffix = MOCK_SECURITY_ASSESSMENT_ROUTES[tool];
    registry.register(
      `platform:GET:/public/v0/projects/versions/{projectVersionId}/security-assessment/${suffix}`,
      (context) => {
        const query = new URL(context.request.url).searchParams;
        const params: Record<string, Json> = {};
        for (const [key, value] of query) {
          if (key !== "scanId") params[key] = value;
        }
        return Response.json(fixture(
          tool,
          context.params.projectVersionId,
          query.get("scanId"),
          params,
        ));
      },
    );
  }
}

export function securityAssessmentFixture(
  tool: SecurityAssessmentTool,
  projectVersionId: string,
  scanId: string | null = null,
  params: Record<string, Json> = {},
): Json {
  return fixture(tool, projectVersionId, scanId, params);
}
