import { createHash } from "node:crypto";

import type { MockHandlerRegistry } from "../types.js";
import { platformArrayPage } from "./paging.js";
import {
  findingProjectVersionId,
  platformSbom,
  type MockPlatformState,
} from "./state.js";

function badRequest(code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status: 400 });
}

function rsqlFilter(
  values: readonly Record<string, unknown>[],
  expression: string | null,
): Record<string, unknown>[] | null {
  if (expression === null || expression.length === 0) return [...values];
  const clauses = expression.split(";");
  let filtered = [...values];
  for (const clause of clauses) {
    const match = /^(name|version|purl|fallbackIdentity)==(.+)$/u.exec(clause);
    if (match === null) return null;
    const [, key, expected] = match;
    filtered = filtered.filter((component) => {
      if (expected === "null") return component[key] === null;
      return component[key] === expected;
    });
  }
  return filtered;
}

function sortComponents(
  values: Record<string, unknown>[],
  sort: string | null,
): void {
  if (sort === null) return;
  const match = /^(name|version):(asc|desc)$/u.exec(sort);
  if (match === null) return;
  const [, key, direction] = match;
  values.sort((left, right) => {
    const compared = String(left[key] ?? "").localeCompare(
      String(right[key] ?? ""),
    );
    return direction === "asc" ? compared : -compared;
  });
}

function scopedSbomBytes(
  state: MockPlatformState,
  projectVersionId: string,
  format: "cyclonedx" | "spdx",
  includeVex: boolean,
): Uint8Array {
  const backing = platformSbom(state);
  const document = JSON.parse(
    Buffer.from(
      format === "cyclonedx" ? backing.sbomBytes : backing.spdxBytes,
    ).toString("utf8"),
  ) as Record<string, unknown>;
  const version = state.versions.get(projectVersionId);
  if (format === "cyclonedx") {
    const metadata = document.metadata as Record<string, unknown>;
    const component = metadata.component as Record<string, unknown>;
    component.version = version?.name;
    metadata.properties = [
      { name: "finite-state:projectVersionId", value: projectVersionId },
      { name: "finite-state:includeVex", value: String(includeVex) },
    ];
    if (includeVex) {
      const vulnerabilities = new Map<string, Record<string, unknown>>();
      for (const finding of state.findings.values()) {
        if (
          findingProjectVersionId(finding, "SBOM finding") !==
            projectVersionId ||
          typeof finding.vexStatus !== "string"
        )
          continue;
        const component = finding.component;
        if (
          component === null ||
          Array.isArray(component) ||
          typeof component !== "object" ||
          !("id" in component) ||
          typeof component.id !== "string"
        )
          continue;
        vulnerabilities.set(String(finding.id), {
          id: finding.cve,
          affects: [{ ref: component.id }],
          analysis: {
            state: finding.vexStatus,
            response:
              typeof finding.vexResponse === "string"
                ? [finding.vexResponse]
                : [],
            justification:
              typeof finding.vexJustification === "string"
                ? finding.vexJustification
                : null,
            detail:
              typeof finding.vexReason === "string" ? finding.vexReason : null,
          },
        });
      }
      document.vulnerabilities = [...vulnerabilities.values()];
    } else {
      delete document.vulnerabilities;
    }
  } else {
    document.name = `Eagle Connected Gateway ${String(version?.name)}`;
    document.documentNamespace = `https://finite-state.example/sbom/${projectVersionId}`;
    document.annotations = includeVex
      ? [...state.findings.values()]
          .filter(
            (finding) =>
              findingProjectVersionId(finding, "SBOM annotation") ===
                projectVersionId && typeof finding.vexStatus === "string",
          )
          .map((finding) => ({
            annotationType: "OTHER",
            annotator: "Tool: Finite State mock",
            annotationDate: "2026-05-12T14:30:00.000Z",
            comment: `VEX ${String(finding.id)}=${String(finding.vexStatus)}`,
          }))
      : [];
  }
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
}

export function registerBomHandlers(
  registry: MockHandlerRegistry,
  state: MockPlatformState,
): void {
  registry.register("platform:GET:/public/v0/components", ({ request }) => {
    const url = new URL(request.url);
    const excluded = url.searchParams.get("excluded") ?? "false";
    const editStatus = url.searchParams.get("editStatus") ?? "any";
    if (
      (excluded !== "true" && excluded !== "false") ||
      (editStatus !== "any" &&
        editStatus !== "edited" &&
        editStatus !== "unedited")
    ) {
      return badRequest(
        "PLATFORM_INVALID_COMPONENT_FILTER",
        "Component filter is invalid",
      );
    }
    const byState = [...state.components.values()].filter((component) => {
      const excludedMatches = component.excluded === (excluded === "true");
      const editedMatches =
        editStatus === "any" || component.edited === (editStatus === "edited");
      return excludedMatches && editedMatches;
    });
    const filtered = rsqlFilter(byState, url.searchParams.get("filter"));
    if (filtered === null)
      return badRequest(
        "PLATFORM_INVALID_FILTER",
        "Component filter is invalid",
      );
    sortComponents(filtered, url.searchParams.get("sort"));
    return platformArrayPage(request, filtered);
  });

  registry.register(
    "platform:GET:/public/v0/components/search",
    ({ request }) => {
      const url = new URL(request.url);
      const name = url.searchParams.get("name")?.trim();
      if (name === undefined || name.length === 0) {
        return badRequest("COMPONENT_NAME_REQUIRED", "name is required");
      }
      const version = url.searchParams.get("version");
      const versionPattern =
        version === null
          ? null
          : new RegExp(
              `^${version
                .split("*")
                .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
                .join(".*")}$`,
              "iu",
            );
      const matches = [...state.components.values()].filter((component) => {
        return (
          String(component.name)
            .toLocaleLowerCase()
            .includes(name.toLocaleLowerCase()) &&
          (versionPattern === null ||
            versionPattern.test(String(component.version)))
        );
      });
      sortComponents(matches, url.searchParams.get("sort"));
      return platformArrayPage(request, matches);
    },
  );

  const download =
    (format: "cyclonedx" | "spdx") =>
    ({
      request,
      params,
    }: {
      request: Request;
      params: Readonly<Record<string, string>>;
    }): Response => {
      if (!state.versions.has(params.projectVersionId)) {
        return Response.json(
          {
            error: {
              code: "VERSION_NOT_FOUND",
              message: "Version was not found",
            },
          },
          { status: 404 },
        );
      }
      const includeVex =
        new URL(request.url).searchParams.get("includeVex") !== "false";
      const bytes = scopedSbomBytes(
        state,
        params.projectVersionId,
        format,
        includeVex,
      );
      const hash = createHash("sha256").update(bytes).digest("hex");
      return new Response(Uint8Array.from(bytes), {
        headers: {
          "Content-Type":
            format === "cyclonedx"
              ? "application/vnd.cyclonedx+json"
              : "application/spdx+json",
          "Content-Length": String(bytes.byteLength),
          "X-Content-Sha256": hash,
        },
      });
    };
  registry.register(
    "platform:GET:/public/v0/sboms/cyclonedx/{projectVersionId}",
    download("cyclonedx"),
  );
  registry.register(
    "platform:GET:/public/v0/sboms/spdx/{projectVersionId}",
    download("spdx"),
  );
}
