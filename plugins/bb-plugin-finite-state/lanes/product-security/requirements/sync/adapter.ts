import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ASSURANCE_STUDIO_MAX_PAGE_SIZE } from "../../../../lib/remote/assurance-studio/client.js";
import type {
  AsEntity,
  AssuranceStudioClient,
  Json,
} from "../../../../lib/remote/types.js";
import { ENTITIES } from "../../../../lib/sync/registry.js";
import type {
  EntityAdapter,
  ServerEntity,
  WorkingEntity,
} from "../../../sync/engine/adapter.js";
import { createSerializer } from "../../../sync/serialize/serializer.js";
import { canonicalRequirement } from "../cards/adapter.js";
import { requirementIdSchema } from "../cards/schema.js";
import { validateRequirementYaml } from "../cards/validator.js";

const REQUIREMENT_DIRECTORY = ENTITIES.requirement.dir;

function stableRequirementId(fields: Readonly<Record<string, Json>>): string {
  for (const key of ["req_id", "reqId", "key", "id"] as const) {
    const candidate = fields[key];
    if (
      typeof candidate === "string" &&
      requirementIdSchema.safeParse(candidate).success
    ) {
      return candidate;
    }
  }
  throw new Error(
    "REMOTE_REQUIREMENT_ID_MISSING: requirement payload lacks a stable REQ-* id.",
  );
}

function projectRemoteRequirement(remote: AsEntity): ServerEntity {
  const requirementId = stableRequirementId(remote.fields);
  return {
    key: ENTITIES.requirement.key({ reqId: requirementId }),
    remoteId: remote.id,
    // Preserve the source fields exactly. The EARS conversion flow owns the
    // reviewed transformation into strict fs-requirement/v1 authored YAML.
    payload: {
      id: remote.id,
      projectId: remote.projectId,
      kind: remote.kind,
      reviewVersion: remote.reviewVersion,
      reviewStatus: remote.reviewStatus,
      humanEdited: remote.humanEdited,
      fields: remote.fields,
    },
  };
}

function isMissingDirectory(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readWorkingRequirements(
  worktreeRoot: string,
): Promise<WorkingEntity[]> {
  const directory = join(worktreeRoot, REQUIREMENT_DIRECTORY);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectory(error)) return [];
    throw error;
  }

  const documents: WorkingEntity[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!/\.ya?ml$/iu.test(entry.name)) continue;
    const file = `${REQUIREMENT_DIRECTORY}/${entry.name}`;
    if (!entry.isFile()) {
      throw new Error(`${file} must be a regular YAML file.`);
    }
    const validated = validateRequirementYaml(
      await readFile(join(worktreeRoot, file), "utf8"),
      file,
    );
    if (!validated.success) {
      const first = validated.errors[0];
      throw new Error(
        first
          ? `${file}:${first.line ?? 1} ${first.code}: ${first.message}`
          : `${file}:1 Requirement YAML is invalid.`,
      );
    }
    const expectedFile = `${REQUIREMENT_DIRECTORY}/${validated.data.id}.yaml`;
    if (file !== expectedFile) {
      throw new Error(
        `${file} declares ${validated.data.id}; expected ${expectedFile}.`,
      );
    }
    documents.push({
      key: ENTITIES.requirement.key({ reqId: validated.data.id }),
      payload: canonicalRequirement(validated.data),
      file,
    });
  }
  return documents;
}

export function createRequirementAdapter(
  client: AssuranceStudioClient,
): EntityAdapter {
  return {
    kind: "requirement",
    klass: "VERSIONED",
    serializer: createSerializer("requirement"),
    async *fetchRemote(scope, onProgress) {
      let pageNumber = 0;
      for await (const page of client.listEntities("requirement", {
        projectId: scope.projectId,
        page: { pageSize: ASSURANCE_STUDIO_MAX_PAGE_SIZE },
      })) {
        pageNumber += 1;
        onProgress({
          page: pageNumber,
          of:
            page.total === null
              ? null
              : Math.ceil(page.total / ASSURANCE_STUDIO_MAX_PAGE_SIZE),
        });
        yield page.items.map(projectRemoteRequirement);
      }
    },
    readWorking: readWorkingRequirements,
  };
}
