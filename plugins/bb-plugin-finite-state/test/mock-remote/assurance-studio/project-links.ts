import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Json } from "../../../lib/remote/types.js";
import type { MockHandler } from "../types.js";

interface ProjectIdentity {
  id: string;
  name: string;
}

interface ProjectLinkFixture {
  projects: ProjectIdentity[];
  links: Array<Record<string, Json>>;
}

function fixture(fixtureRoot: string): ProjectLinkFixture {
  return JSON.parse(
    readFileSync(
      resolve(fixtureRoot, "assurance-studio/project-links.json"),
      "utf8",
    ),
  ) as ProjectLinkFixture;
}

function projectWire(project: ProjectIdentity): Record<string, Json> {
  return {
    id: project.id,
    organization_id: "fixture-organization",
    name: project.name,
    description: "Captured-shape project fixture",
    product_name: project.name,
    manufacturer: "Fixture Manufacturer",
    device_category: "other",
    lifecycle_stage: "development",
    scoring_method: "cvss",
    risk_matrix_profile: "default",
    workflow_status: {
      risk_assessment: "pending",
      threat_analysis: "pending",
      report_generation: "pending",
      document_processing: "pending",
      mitigation_planning: "pending",
      asset_identification: "pending",
      attack_path_analysis: "pending",
      architecture_analysis: "pending",
      requirements_generation: "pending",
    },
    version: 1,
    source: "fixture",
    created_by: "fixture-user",
    created_at: "2026-05-12T14:30:00.000Z",
    updated_at: "2026-05-12T14:30:00.000Z",
    deleted_at: null,
    audit_target_date: null,
    compliance_control_map: "",
    evidence_assessment_summary: "",
    compliance_coverage_report: "",
    document_count: 0,
    component_count: 0,
    zone_count: 0,
    asset_count: 0,
    threat_count: 0,
    risk_count: 0,
    mitigation_count: 0,
    requirement_count: 0,
    report_count: 0,
    scope_spec_count: 0,
    data_flow_count: 0,
    attack_path_count: 0,
    exploitability_count: 0,
    damage_scenario_count: 0,
    extended_workflow_status: {
      scope_extraction: "pending",
      damage_assessment: "pending",
      data_flow_analysis: "pending",
      exploitability_assessment: "pending",
    },
    verification_check_count: 0,
    verification_verified_count: 0,
    verification_failed_count: 0,
    verification_pending_count: 0,
    verified_tara_score_overall: 0,
    verification_distinct_check_count: 0,
    verification_distinct_verified_count: 0,
    verification_distinct_failed_count: 0,
    verification_distinct_pending_count: 0,
    qms_framework_enabled: false,
    qms_frameworks: [],
    audit_readiness_data: {},
    hazard_mapping_enabled: false,
    verification_error_count: 0,
    verification_inconclusive_count: 0,
    verification_skipped_count: 0,
    verification_running_count: 0,
    verification_distinct_error_count: 0,
    verification_distinct_inconclusive_count: 0,
    verification_distinct_skipped_count: 0,
    verification_distinct_running_count: 0,
    cloned_from_project_id: null,
    is_template: false,
    min_ai_confidence_tier: "medium",
    project_kind: "tara",
    trial_parent_project_id: null,
    tara_history_dirty: false,
    head_tara_version_id: null,
    risk_summary: { critical: 0, high: 0, medium: 0, low: 0 },
    progress: 0,
    workflow_current_stage: "architecture_analysis",
  };
}

function page(request: Request): { page: number; limit: number } {
  const query = new URL(request.url).searchParams;
  const pageNumber = Number(query.get("page") ?? "1");
  const limit = Number(query.get("limit") ?? "50");
  if (
    !Number.isSafeInteger(pageNumber) ||
    pageNumber < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  ) {
    throw new Error("AS_INVALID_PAGE");
  }
  return { page: pageNumber, limit };
}

export function projectListHandler(fixtureRoot: string): MockHandler {
  const projects = fixture(fixtureRoot).projects.map(projectWire);
  return ({ request }) => {
    const paging = page(request);
    const start = (paging.page - 1) * paging.limit;
    const items = projects.slice(start, start + paging.limit);
    return Response.json({
      success: true,
      data: {
        items,
        total: projects.length,
        page: paging.page,
        pageSize: paging.limit,
        hasMore: start + items.length < projects.length,
      },
    });
  };
}

export function projectLinksHandler(fixtureRoot: string): MockHandler {
  const links = fixture(fixtureRoot).links;
  return ({ params }) =>
    Response.json({
      success: true,
      data: links.filter((link) => link.project_id === params.projectId),
    });
}
