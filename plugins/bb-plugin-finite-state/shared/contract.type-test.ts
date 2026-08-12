import type { PluginRpcClient } from "@bb/plugin-sdk/app";
import type { PluginRpcHandlers } from "@bb/plugin-sdk";
import type { HumanApprovalCapability, RpcContract } from "./contract.js";

type Handlers = PluginRpcHandlers<RpcContract>;

const deleteCommentHandler: Handlers["findingsCommentsDelete"] = (input) => {
  const projectId: string = input.projectId;
  const projectVersionId: string | null = input.projectVersionId;
  const capability: HumanApprovalCapability = input.humanApprovalCapability;
  void projectId;
  void projectVersionId;
  void capability;
  return { projectId, projectVersionId, success: true };
};

function assertFrontendInference(client: PluginRpcClient<RpcContract>) {
  const finding = client.call("findingsGet", {
    projectId: "123",
    projectVersionId: "456",
    findingId: "789",
  });
  const plan = client.call("syncPlan", {
    projectId: "123",
    projectVersionId: null,
    kinds: ["findings"],
  });
  const page = client.call("documentsList", {
    projectId: "123",
    projectVersionId: "456",
    pageSize: 50,
    continuation: "opaque",
  });

  const findingResult: Promise<{
    projectId: string;
    projectVersionId: string | null;
    kind: string;
    key: string;
    label: string;
    fields: Record<string, import("./contract.js").JsonValue>;
    links: Array<{
      projectId: string;
      projectVersionId: string | null;
      kind: string;
      key: string;
      label: string;
    }>;
    cache: {
      state: "fresh" | "stale" | "empty";
      asOf: string | null;
      message: string | null;
    };
  }> = finding;
  void findingResult;
  void plan;
  void page;

  // @ts-expect-error logical dotted names are documentation names, not wire keys.
  void client.call("findings.get", null);
  // @ts-expect-error scoped calls require projectId and projectVersionId.
  void client.call("findingsGet", { findingId: "789" });
  void client.call("findingsGet", {
    projectId: "123",
    // @ts-expect-error pvId is not an accepted scope alias.
    pvId: "456",
    findingId: "789",
  });
  void client.call("documentsList", {
    projectId: "123",
    projectVersionId: "456",
    // @ts-expect-error cursor/limit are transport aliases, not normalized paging.
    limit: 50,
    cursor: null,
  });
  void client.call("findingsCommentsDelete", {
    projectId: "123",
    projectVersionId: "456",
    findingId: "789",
    commentId: "10",
    commentSnapshotSha256: "a".repeat(64),
    // @ts-expect-error a caller confirmation boolean is not human authorization.
    confirmed: true,
  });
  // @ts-expect-error the human-only route reserves its opaque capability.
  void client.call("findingsCommentsDelete", {
    projectId: "123",
    projectVersionId: "456",
    findingId: "789",
    commentId: "10",
    commentSnapshotSha256: "a".repeat(64),
  });
}

void deleteCommentHandler;
void assertFrontendInference;
