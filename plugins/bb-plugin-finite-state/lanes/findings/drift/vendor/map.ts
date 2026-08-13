import type {
  VexJustification,
  VexResponse,
  VexStatus,
} from "../../../../lib/remote/types.js";
import type { TriageOverlayV1 } from "../../overlay/schema.js";
import type { ParsedVendorVex } from "./parse.js";

export interface NormalizedVendorStatement {
  cve: string;
  component: TriageOverlayV1["component"];
  status: VexStatus;
  justification: VexJustification | null;
  response: VexResponse | null;
  reason: string | null;
  sourceRef: string;
}

export interface VendorMapError {
  sourceRef?: string;
  code: string;
  message: string;
}

export interface MappedVendorVex {
  statements: NormalizedVendorStatement[];
  errors: VendorMapError[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.normalize("NFC") : null;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((item): item is string => item !== null) : [];
}

function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function purlComponent(purl: string, fallbackName?: string | null): TriageOverlayV1["component"] | null {
  if (!purl.startsWith("pkg:")) return null;
  const path = purl.slice(4).split(/[?#]/u, 1)[0] ?? "";
  const slash = path.indexOf("/");
  if (slash < 0) return null;
  const segments = path.slice(slash + 1).split("/");
  const leaf = segments.pop();
  if (leaf === undefined || leaf.length === 0) return null;
  const at = leaf.lastIndexOf("@");
  const name = decoded(at < 0 ? leaf : leaf.slice(0, at)) ?? fallbackName ?? null;
  const version = at < 0 ? null : decoded(leaf.slice(at + 1));
  const groupSegments = segments.map(decoded);
  if (name === null || groupSegments.some((segment) => segment === null)) return null;
  return {
    purl,
    name,
    group: groupSegments.length === 0 ? null : groupSegments.join("/"),
    version: version === "" ? null : version,
  };
}

function component(
  purl: string | null,
  name: string | null,
  group: string | null = null,
  version: string | null = null,
): TriageOverlayV1["component"] | null {
  if (purl !== null) return purlComponent(purl, name);
  if (name === null) return null;
  return { purl: null, name, group, version };
}

const CDX_STATUS: Readonly<Record<string, VexStatus>> = {
  exploitable: "EXPLOITABLE",
  in_triage: "IN_TRIAGE",
  not_affected: "NOT_AFFECTED",
  false_positive: "FALSE_POSITIVE",
  resolved: "RESOLVED",
  resolved_with_pedigree: "RESOLVED_WITH_PEDIGREE",
};

const CDX_JUSTIFICATION: Readonly<Record<string, VexJustification>> = {
  code_not_present: "CODE_NOT_PRESENT",
  code_not_reachable: "CODE_NOT_REACHABLE",
  requires_configuration: "REQUIRES_CONFIGURATION",
  requires_dependency: "REQUIRES_DEPENDENCY",
  requires_environment: "REQUIRES_ENVIRONMENT",
  protected_by_compiler: "PROTECTED_BY_COMPILER",
  protected_at_runtime: "PROTECTED_AT_RUNTIME",
  protected_at_perimeter: "PROTECTED_AT_PERIMETER",
  protected_by_mitigating_control: "PROTECTED_BY_MITIGATING_CONTROL",
};

const OPENVEX_JUSTIFICATION: Readonly<Record<string, VexJustification>> = {
  component_not_present: "CODE_NOT_PRESENT",
  vulnerable_code_not_present: "CODE_NOT_PRESENT",
  vulnerable_code_not_in_execute_path: "CODE_NOT_REACHABLE",
  inline_mitigations_already_exist: "PROTECTED_BY_MITIGATING_CONTROL",
};

const RESPONSE: Readonly<Record<string, VexResponse>> = {
  can_not_fix: "CAN_NOT_FIX",
  will_not_fix: "WILL_NOT_FIX",
  update: "UPDATE",
  rollback: "ROLLBACK",
  workaround_available: "WORKAROUND_AVAILABLE",
};

function sourceRef(parsed: ParsedVendorVex, pointer: string): string {
  return `${parsed.file}#${pointer}`;
}

function cyclonedx(parsed: ParsedVendorVex): MappedVendorVex {
  const statements: NormalizedVendorStatement[] = [];
  const errors: VendorMapError[] = [];
  const components = new Map<string, TriageOverlayV1["component"]>();
  for (const [index, value] of (Array.isArray(parsed.document["components"]) ? parsed.document["components"] : []).entries()) {
    const raw = record(value);
    if (raw === null) continue;
    const ref = text(raw["bom-ref"]);
    const parsedComponent = component(text(raw["purl"]), text(raw["name"]), text(raw["group"]), text(raw["version"]));
    if (ref !== null && parsedComponent !== null) components.set(ref, parsedComponent);
    else if (ref !== null) errors.push({
      sourceRef: sourceRef(parsed, `/components/${index}`),
      code: "COMPONENT_IDENTITY_INVALID",
      message: `CycloneDX component ${ref} has no usable purl or name`,
    });
  }
  const vulnerabilities = Array.isArray(parsed.document["vulnerabilities"]) ? parsed.document["vulnerabilities"] : [];
  for (const [vulnerabilityIndex, value] of vulnerabilities.entries()) {
    const vulnerability = record(value);
    const pointer = `/vulnerabilities/${vulnerabilityIndex}`;
    if (vulnerability === null) {
      errors.push({ sourceRef: sourceRef(parsed, pointer), code: "STATEMENT_INVALID", message: "CycloneDX vulnerability must be an object" });
      continue;
    }
    const cve = text(vulnerability["id"]);
    const analysis = record(vulnerability["analysis"]);
    const rawState = text(analysis?.["state"]);
    const status = rawState === null ? undefined : CDX_STATUS[rawState];
    if (cve === null || status === undefined) {
      errors.push({ sourceRef: sourceRef(parsed, pointer), code: "STATUS_UNSUPPORTED", message: "CycloneDX vulnerability requires an id and documented analysis.state" });
      continue;
    }
    const rawJustification = text(analysis?.["justification"]);
    const justification = rawJustification === null ? null : CDX_JUSTIFICATION[rawJustification];
    if (rawJustification !== null && justification === undefined) {
      errors.push({ sourceRef: sourceRef(parsed, pointer), code: "JUSTIFICATION_UNSUPPORTED", message: `Unsupported CycloneDX justification ${rawJustification}` });
      continue;
    }
    const responses = textArray(analysis?.["response"]);
    if (responses.length > 1 || (responses[0] !== undefined && RESPONSE[responses[0]] === undefined)) {
      errors.push({ sourceRef: sourceRef(parsed, pointer), code: "RESPONSE_UNSUPPORTED", message: "CycloneDX response must contain at most one documented response value" });
      continue;
    }
    const affects = Array.isArray(vulnerability["affects"]) ? vulnerability["affects"] : [];
    if (affects.length === 0) {
      errors.push({ sourceRef: sourceRef(parsed, pointer), code: "SUBJECT_MISSING", message: "CycloneDX vulnerability has no affects references" });
      continue;
    }
    for (const [affectIndex, affectValue] of affects.entries()) {
      const affect = record(affectValue);
      const ref = text(affect?.["ref"]);
      const target = ref === null ? null : components.get(ref) ?? purlComponent(ref);
      const refPointer = `${pointer}/affects/${affectIndex}`;
      if (target === null || target === undefined) {
        errors.push({ sourceRef: sourceRef(parsed, refPointer), code: "SUBJECT_UNRESOLVED", message: `CycloneDX affects reference ${ref ?? "<missing>"} has no component identity` });
        continue;
      }
      statements.push({
        cve,
        component: target,
        status,
        justification: justification ?? null,
        response: responses[0] === undefined ? null : RESPONSE[responses[0]] ?? null,
        reason: text(analysis?.["detail"]),
        sourceRef: sourceRef(parsed, refPointer),
      });
    }
  }
  return { statements, errors };
}

function csafProduct(value: unknown): { id: string; target: TriageOverlayV1["component"] } | null {
  const product = record(value);
  const id = text(product?.["product_id"]);
  const helper = record(product?.["product_identification_helper"]);
  const target = component(text(helper?.["purl"]), text(product?.["name"]));
  return id === null || target === null ? null : { id, target };
}

function csafProducts(document: Record<string, unknown>): Map<string, TriageOverlayV1["component"]> {
  const products = new Map<string, TriageOverlayV1["component"]>();
  const tree = record(document["product_tree"]);
  const visit = (branches: unknown): void => {
    if (!Array.isArray(branches)) return;
    for (const value of branches) {
      const branch = record(value);
      if (branch === null) continue;
      const parsed = csafProduct(branch["product"]);
      if (parsed !== null) products.set(parsed.id, parsed.target);
      visit(branch["branches"]);
    }
  };
  visit(tree?.["branches"]);
  for (const value of Array.isArray(tree?.["full_product_names"]) ? tree["full_product_names"] : []) {
    const parsed = csafProduct(value);
    if (parsed !== null) products.set(parsed.id, parsed.target);
  }
  for (const value of Array.isArray(tree?.["relationships"]) ? tree["relationships"] : []) {
    const relationship = record(value);
    const full = csafProduct(relationship?.["full_product_name"]);
    const fullName = record(relationship?.["full_product_name"]);
    const id = text(fullName?.["product_id"]);
    const productReference = text(relationship?.["product_reference"]);
    const relatedReference = text(relationship?.["relates_to_product_reference"]);
    const target = (productReference === null ? undefined : products.get(productReference))
      ?? full?.target
      ?? (relatedReference === null ? undefined : products.get(relatedReference));
    if (id !== null && target !== undefined) products.set(id, target);
  }
  return products;
}

function csafScopedDetail(values: unknown, category: string, productId: string): string | null {
  if (!Array.isArray(values)) return null;
  for (const value of values) {
    const item = record(value);
    if (item?.["category"] !== category) continue;
    const ids = textArray(item["product_ids"]);
    if (ids.length === 0 || ids.includes(productId)) return text(item["details"]);
  }
  return null;
}

type CsafJustification =
  | { state: "absent" }
  | { state: "mapped"; value: VexJustification }
  | { state: "unsupported"; label: string };

function csafJustification(values: unknown, productId: string): CsafJustification {
  if (!Array.isArray(values)) return { state: "absent" };
  for (const value of values) {
    const flag = record(value);
    if (flag === null) continue;
    const ids = textArray(flag["product_ids"]);
    if (ids.length > 0 && !ids.includes(productId)) continue;
    const label = text(flag["label"]);
    if (label === null) continue;
    const mapped = OPENVEX_JUSTIFICATION[label];
    return mapped === undefined ? { state: "unsupported", label } : { state: "mapped", value: mapped };
  }
  return { state: "absent" };
}

const CSAF_STATUS: Readonly<Record<string, VexStatus>> = {
  fixed: "RESOLVED",
  known_affected: "EXPLOITABLE",
  known_not_affected: "NOT_AFFECTED",
  under_investigation: "IN_TRIAGE",
};

function csaf(parsed: ParsedVendorVex): MappedVendorVex {
  const statements: NormalizedVendorStatement[] = [];
  const errors: VendorMapError[] = [];
  const products = csafProducts(parsed.document);
  const vulnerabilities = Array.isArray(parsed.document["vulnerabilities"]) ? parsed.document["vulnerabilities"] : [];
  for (const [vulnerabilityIndex, value] of vulnerabilities.entries()) {
    const vulnerability = record(value);
    const pointer = `/vulnerabilities/${vulnerabilityIndex}`;
    const cve = text(vulnerability?.["cve"]) ?? text(vulnerability?.["id"]);
    const statuses = record(vulnerability?.["product_status"]);
    if (vulnerability === null || cve === null || statuses === null) {
      errors.push({ sourceRef: sourceRef(parsed, pointer), code: "STATEMENT_INVALID", message: "CSAF vulnerability requires cve/id and product_status" });
      continue;
    }
    for (const statusName of Object.keys(statuses).sort()) {
      if (CSAF_STATUS[statusName] !== undefined) continue;
      errors.push({
        sourceRef: sourceRef(parsed, `${pointer}/product_status/${statusName}`),
        code: "STATUS_BUCKET_UNSUPPORTED",
        message: `Unsupported CSAF product_status bucket ${statusName}`,
      });
    }
    for (const [statusName, status] of Object.entries(CSAF_STATUS)) {
      const productIds = textArray(statuses[statusName]);
      for (const [productIndex, productId] of productIds.entries()) {
        const target = products.get(productId);
        const productPointer = `${pointer}/product_status/${statusName}/${productIndex}`;
        if (target === undefined) {
          errors.push({
            sourceRef: sourceRef(parsed, productPointer),
            code: "SUBJECT_UNRESOLVED",
            message: `CSAF product ${productId} has no usable identity in product_tree branches, full_product_names, or relationships`,
          });
          continue;
        }
        const justification = status === "NOT_AFFECTED"
          ? csafJustification(vulnerability["flags"], productId)
          : { state: "absent" } as const;
        if (justification.state === "unsupported") {
          errors.push({
            sourceRef: sourceRef(parsed, productPointer),
            code: "JUSTIFICATION_UNSUPPORTED",
            message: `Unsupported CSAF justification ${justification.label}`,
          });
          continue;
        }
        statements.push({
          cve,
          component: target,
          status,
          justification: justification.state === "mapped" ? justification.value : null,
          response: null,
          reason: status === "NOT_AFFECTED"
            ? csafScopedDetail(vulnerability["threats"], "impact", productId)
            : status === "EXPLOITABLE"
              ? csafScopedDetail(vulnerability["remediations"], "workaround", productId)
              : null,
          sourceRef: sourceRef(parsed, productPointer),
        });
      }
    }
  }
  return { statements, errors };
}

const OPENVEX_STATUS: Readonly<Record<string, VexStatus>> = {
  affected: "EXPLOITABLE",
  fixed: "RESOLVED",
  under_investigation: "IN_TRIAGE",
  not_affected: "NOT_AFFECTED",
};

function openVexComponent(value: unknown): TriageOverlayV1["component"] | null {
  const raw = record(value);
  if (raw === null) return null;
  const identifiers = record(raw["identifiers"]);
  const id = text(raw["@id"]);
  const purl = text(identifiers?.["purl"]) ?? (id?.startsWith("pkg:") === true ? id : null);
  return component(purl, id);
}

function openvex(parsed: ParsedVendorVex): MappedVendorVex {
  const statements: NormalizedVendorStatement[] = [];
  const errors: VendorMapError[] = [];
  const rawStatements = Array.isArray(parsed.document["statements"]) ? parsed.document["statements"] : [];
  for (const [statementIndex, value] of rawStatements.entries()) {
    const statement = record(value);
    const pointer = `/statements/${statementIndex}`;
    const vulnerability = record(statement?.["vulnerability"]);
    const cve = text(vulnerability?.["name"]);
    const rawStatus = text(statement?.["status"]);
    const status = rawStatus === null ? undefined : OPENVEX_STATUS[rawStatus];
    if (statement === null || cve === null || status === undefined) {
      errors.push({ sourceRef: sourceRef(parsed, pointer), code: "STATUS_UNSUPPORTED", message: "OpenVEX statement requires vulnerability.name and a documented status" });
      continue;
    }
    const rawJustification = text(statement["justification"]);
    const justification = rawJustification === null ? null : OPENVEX_JUSTIFICATION[rawJustification];
    if (rawJustification !== null && justification === undefined) {
      errors.push({ sourceRef: sourceRef(parsed, pointer), code: "JUSTIFICATION_UNSUPPORTED", message: `Unsupported OpenVEX justification ${rawJustification}` });
      continue;
    }
    const subjects = Array.isArray(statement["subcomponents"]) && statement["subcomponents"].length > 0
      ? statement["subcomponents"]
      : statement["products"];
    if (!Array.isArray(subjects) || subjects.length === 0) {
      errors.push({ sourceRef: sourceRef(parsed, pointer), code: "SUBJECT_MISSING", message: "OpenVEX statement has no product or subcomponent" });
      continue;
    }
    for (const [subjectIndex, subject] of subjects.entries()) {
      const target = openVexComponent(subject);
      const subjectPointer = `${pointer}/${subjects === statement["subcomponents"] ? "subcomponents" : "products"}/${subjectIndex}`;
      if (target === null) {
        errors.push({ sourceRef: sourceRef(parsed, subjectPointer), code: "SUBJECT_UNRESOLVED", message: "OpenVEX subject has no usable identifier" });
        continue;
      }
      statements.push({
        cve,
        component: target,
        status,
        justification: justification ?? null,
        response: null,
        reason: status === "NOT_AFFECTED"
          ? text(statement["impact_statement"])
          : status === "EXPLOITABLE"
            ? text(statement["action_statement"])
            : text(statement["status_notes"]),
        sourceRef: sourceRef(parsed, subjectPointer),
      });
    }
  }
  return { statements, errors };
}

export function mapVendorVex(parsed: ParsedVendorVex): MappedVendorVex {
  if (parsed.format === "cyclonedx") return cyclonedx(parsed);
  if (parsed.format === "csaf") return csaf(parsed);
  return openvex(parsed);
}
