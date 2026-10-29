import {
  hostDaemonSkillTreeContentRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import type { SkillTreeManifest } from "../services/skills/injected-skills.js";
import { createSkillTreeContentResponse } from "../services/skills/skill-tree-content.js";

const TREE_HASH_PATTERN = /^[a-f0-9]{64}$/u;

function requireRegisteredTree(
  deps: AppDeps,
  requestedHash: string,
): SkillTreeManifest {
  const manifest = TREE_HASH_PATTERN.test(requestedHash)
    ? deps.skillTreeRegistry.manifest(requestedHash)
    : undefined;
  if (manifest === undefined) {
    throw new ApiError(404, "skill_tree_not_found", "Skill tree not found");
  }
  return manifest;
}

export function registerInternalSkillRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<HostDaemonInternalSchema>(app);

  get("/skills/tree/:hash", (context) => {
    const manifest = requireRegisteredTree(deps, context.req.param("hash"));
    return context.json({
      treeHash: manifest.treeHash,
      files: manifest.files.map((file) => ({
        path: file.path,
        mode: file.mode,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
      })),
    });
  });

  post(
    "/skills/tree/:hash/content",
    hostDaemonSkillTreeContentRequestSchema,
    (context, body) =>
      createSkillTreeContentResponse({
        manifest: requireRegisteredTree(deps, context.req.param("hash")),
        paths: body.paths,
      }),
  );
}
