import {
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { readSkillTreeManifest } from "../services/skills/injected-skills.js";

const TREE_HASH_PATTERN = /^[a-f0-9]{64}$/u;

export function registerInternalSkillRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<HostDaemonInternalSchema>(app);

  get("/skills/tree/:hash", (context) => {
    const requestedHash = context.req.param("hash");
    if (!TREE_HASH_PATTERN.test(requestedHash)) {
      throw new ApiError(404, "skill_tree_not_found", "Skill tree not found");
    }
    const sourceRootPath = deps.skillTreeRegistry.resolve(requestedHash);
    if (sourceRootPath === undefined) {
      throw new ApiError(404, "skill_tree_not_found", "Skill tree not found");
    }

    let manifest;
    try {
      manifest = readSkillTreeManifest(sourceRootPath);
    } catch {
      throw new ApiError(404, "skill_tree_not_found", "Skill tree not found");
    }
    if (manifest.treeHash !== requestedHash) {
      throw new ApiError(404, "skill_tree_not_found", "Skill tree not found");
    }

    return context.json({
      treeHash: manifest.treeHash,
      entries: manifest.entries.map((entry) => ({
        path: entry.path,
        mode: entry.mode,
        contentBase64: entry.bytes.toString("base64"),
      })),
    });
  });
}
