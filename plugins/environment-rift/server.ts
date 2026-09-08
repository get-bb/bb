import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { riftBranchSchema, riftHostContract } from "./contract.js";
import { RIFT_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";

const CREATE_TIMEOUT_MS = 15 * 60 * 1000;
const REMOVE_TIMEOUT_MS = 15 * 60 * 1000;

export const riftInputsSchema = z
  .object({
    branch: riftBranchSchema.default({ kind: "default" }),
    copy: z.enum(["all", "filtered"]).default("all"),
  })
  .default({ branch: { kind: "default" }, copy: "all" });
export type RiftInputs = z.infer<typeof riftInputsSchema>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function riftPlugin(bb: BbPluginApi): Promise<void> {
  const host = bb.hosts.experimental_client({
    contract: riftHostContract,
  });
  bb.experimental_environments.register({
    id: RIFT_ENVIRONMENT_PROVIDER_ID,
    displayName: "Rift workspace",
    presentation: { groupsThreads: true, kindLabel: "Rift workspace" },
    icon: "Copy",
    requires: { gitCheckout: true },
    inputs: riftInputsSchema,
    policy: { pathKeys: "per-attempt" },
    async availability(context) {
      if (context.host === null)
        return { status: "unavailable", message: "Select a machine" };
      const result = await host.call(
        "availability",
        {},
        { hostId: context.host.id },
      );
      return result.installed
        ? { status: "available" }
        : {
            status: "setup-required",
            message:
              "Install Rift on this machine: npm install -g rift-snapshot",
          };
    },
    async validate(context) {
      const result = await host.call(
        "validate",
        { sourcePath: context.projectCheckout.path },
        { hostId: context.host.id },
      );
      return result.status === "accept"
        ? { action: "accept" }
        : { action: "refuse", message: result.message };
    },
    async create(context) {
      const hostId = context.host.id;
      try {
        const resolved = await host.call(
          "resolvePath",
          { pathKey: context.pathKey },
          { hostId, signal: context.signal },
        );
        if (!(await context.experimental_claimPath(resolved.path))) {
          return {
            status: "failed",
            failure: "terminal",
            message: "The Rift workspace path is already in use",
          };
        }
        const result = await host.call(
          "create",
          {
            sourcePath: context.projectCheckout.path,
            pathKey: context.pathKey,
            branchName:
              context.inputs.branch.kind === "named"
                ? context.inputs.branch.name
                : context.suggestedBranchName,
            copy: context.inputs.copy,
          },
          { hostId, signal: context.signal, timeoutMs: CREATE_TIMEOUT_MS },
        );
        if (result.status === "failed") {
          return {
            status: "failed",
            failure: "terminal",
            message: result.message,
          };
        }
        return {
          status: "created",
          path: result.path,
          ownsPath: true,
          mergeBaseBranch: result.mergeBaseBranch,
        };
      } catch (error) {
        if (context.signal.aborted) throw error;
        return {
          status: "failed",
          failure: "transient",
          message: errorMessage(error),
        };
      }
    },
    async remove(context) {
      if (context.path === null) return { status: "removed" };
      if (context.environment?.managed === false) return { status: "removed" };
      if (context.hostId === null) {
        return { status: "failed", message: "The rift machine is unknown" };
      }
      try {
        const result = await host.call(
          "remove",
          {
            pathKey: context.pathKey,
            path: context.path,
          },
          {
            hostId: context.hostId,
            signal: context.signal,
            timeoutMs: REMOVE_TIMEOUT_MS,
          },
        );
        return result;
      } catch (error) {
        if (context.signal.aborted) throw error;
        return { status: "failed", message: errorMessage(error) };
      }
    },
  });
}
