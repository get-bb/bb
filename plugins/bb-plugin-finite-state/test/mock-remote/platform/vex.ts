import {
  VEX_JUSTIFICATIONS,
  VEX_RESPONSES,
  VEX_STATUSES,
} from "../../../lib/remote/types.js";
import type { MockHandlerRegistry } from "../types.js";
import { platformVexFailure, type MockPlatformState } from "./state.js";

const DECIMAL_ID = /^-?[0-9]+$/u;
const DECISION_KEYS = new Set(["findingId", "status", "response", "justification", "reason"]);
const SINGLE_DECISION_KEYS = new Set(["status", "response", "justification", "reason"]);
const STATUS_SET: ReadonlySet<string> = new Set(VEX_STATUSES);

interface Decision {
  readonly findingId: string;
  readonly status: string;
  readonly response: string | null;
  readonly justification: string | null;
  readonly reason: string | null;
}

function error(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function optionalEnum(value: unknown, allowed: readonly string[]): string | null | undefined {
  if (value === undefined) return null;
  return typeof value === "string" && allowed.includes(value) ? value : undefined;
}

function decision(value: unknown, pathFindingId?: string): Decision | null {
  const record = object(value);
  const allowedKeys = pathFindingId === undefined ? DECISION_KEYS : SINGLE_DECISION_KEYS;
  if (record === null || Object.keys(record).some((key) => !allowedKeys.has(key))) return null;
  const findingId = pathFindingId ?? record.findingId;
  const response = optionalEnum(record.response, VEX_RESPONSES);
  const justification = optionalEnum(record.justification, VEX_JUSTIFICATIONS);
  if (
    typeof findingId !== "string" || !DECIMAL_ID.test(findingId) ||
    typeof record.status !== "string" || !STATUS_SET.has(record.status) ||
    response === undefined || justification === undefined ||
    (record.reason !== undefined && typeof record.reason !== "string")
  ) {
    return null;
  }
  return {
    findingId,
    status: record.status,
    response,
    justification,
    reason: typeof record.reason === "string" ? record.reason : null,
  };
}

function matchingFindings(
  state: MockPlatformState,
  projectVersionId: string,
  findingId: string,
): Record<string, unknown>[] {
  return [...state.findings.values()].filter(
    (finding) => finding.projectVersionId === projectVersionId && finding.id === findingId,
  );
}

function applyDecision(finding: Record<string, unknown>, value: Decision): void {
  finding.vexStatus = value.status;
  finding.vexResponse = value.response;
  finding.vexJustification = value.justification;
  finding.vexReason = value.reason;
}

export function registerVexHandlers(
  registry: MockHandlerRegistry,
  state: MockPlatformState,
): void {
  registry.register(
    "platform:PUT:/public/v0/findings/{projectVersionId}/{findingId}/status",
    async ({ request, params }) => {
      const value = decision(await request.json(), params.findingId);
      if (value === null) {
        return error(400, "INVALID_VEX_DECISION", "VEX decision is invalid");
      }
      const findings = matchingFindings(state, params.projectVersionId, params.findingId);
      if (findings.length === 0) {
        return error(404, "FINDING_NOT_FOUND", "Finding was not found in this version");
      }
      findings.forEach((finding) => applyDecision(finding, value));
      return new Response(null, { status: 204 });
    },
  );

  registry.register(
    "platform:PUT:/public/v0/findings/{projectVersionId}/status/set/bulk",
    async ({ request, params }) => {
      const body = object(await request.json());
      if (body === null || Object.keys(body).some((key) => key !== "findings") || !Array.isArray(body.findings)) {
        return error(400, "INVALID_VEX_BATCH", "Bulk VEX request is invalid");
      }
      if (body.findings.length > 5_000) {
        return error(400, "VEX_BATCH_TOO_LARGE", "Bulk VEX request exceeds 5000 items");
      }
      const decisions = body.findings.map((value) => decision(value));
      if (decisions.some((value) => value === null)) {
        return error(400, "INVALID_VEX_BATCH", "Bulk VEX request contains an invalid decision");
      }
      const valid = decisions.filter((value): value is Decision => value !== null);
      if (new Set(valid.map((value) => value.findingId)).size !== valid.length) {
        return error(400, "DUPLICATE_FINDING_ID", "Bulk VEX request contains duplicate finding ids");
      }

      const results = valid.map((value) => {
        const findings = matchingFindings(state, params.projectVersionId, value.findingId);
        const fixtureFailure = platformVexFailure(state, value.findingId);
        if (findings.length === 0 || fixtureFailure !== null) {
          return {
            findingId: value.findingId,
            success: false,
            status: null,
            error: fixtureFailure ?? "not found",
          };
        }
        findings.forEach((finding) => applyDecision(finding, value));
        return { findingId: value.findingId, success: true, status: value.status, error: null };
      });
      const succeeded = results.filter((result) => result.success).length;
      const failed = results.length - succeeded;
      return Response.json({
        status: failed === 0 ? "success" : succeeded === 0 ? "failure" : "partial_success",
        summary: { total: results.length, succeeded, failed },
        results,
      });
    },
  );

  registry.register(
    "platform:PUT:/public/v0/findings/{projectVersionId}/status/clear/bulk",
    async ({ request, params }) => {
      const body = object(await request.json());
      if (
        body === null || Object.keys(body).some((key) => key !== "findingIds") ||
        !Array.isArray(body.findingIds) || body.findingIds.length === 0 ||
        body.findingIds.some((findingId) => typeof findingId !== "string" || !DECIMAL_ID.test(findingId))
      ) {
        return error(400, "INVALID_VEX_CLEAR", "Bulk VEX clear request is invalid");
      }
      for (const findingId of body.findingIds) {
        for (const finding of matchingFindings(state, params.projectVersionId, findingId)) {
          finding.vexStatus = null;
          finding.vexResponse = null;
          finding.vexJustification = null;
          finding.vexReason = null;
        }
      }
      return new Response(null, { status: 204 });
    },
  );
}
