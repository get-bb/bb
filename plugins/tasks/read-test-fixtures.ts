import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { tasksRpcContract } from "./shared/contract.js";
import { rpcInput } from "./test-fixtures.js";

type Handlers = NonNullable<RenderSlotOptions["rpc"]>;

function rows(result: unknown, field: string): unknown[] {
  const value = rpcInput(result)[field];
  if (!Array.isArray(value)) throw new Error(`Expected ${field} rows`);
  return value;
}

export function withReadBatches(rpc: Handlers): Handlers {
  return {
    ...rpc,
    ...(!rpc.listLabelsForProjects && rpc.listLabels
      ? {
          listLabelsForProjects: async (raw: unknown) => {
            const { projectIds } =
              tasksRpcContract.listLabelsForProjects.input.parse(raw);
            const results = await Promise.all(
              projectIds.map((projectId) => rpc.listLabels!({ projectId })),
            );
            return {
              labels: results.flatMap((result) => rows(result, "labels")),
            };
          },
        }
      : {}),
    ...(!rpc.taskMetadata && (rpc.listTaskThreads || rpc.listAttachments)
      ? {
          taskMetadata: async (raw: unknown) => {
            const { taskIds, includeAttachmentCounts } =
              tasksRpcContract.taskMetadata.input.parse(raw);
            return {
              items: await Promise.all(
                taskIds.map(async (taskId) => ({
                  taskId,
                  taskThreads: rpc.listTaskThreads
                    ? rows(await rpc.listTaskThreads({ taskId }), "taskThreads")
                    : [],
                  attachmentCount: includeAttachmentCounts
                    ? rpc.listAttachments
                      ? rows(
                          await rpc.listAttachments({ taskId }),
                          "attachments",
                        ).length
                      : 0
                    : null,
                })),
              ),
            };
          },
        }
      : {}),
    ...(!rpc.activityFeed && rpc.listComments
      ? {
          activityFeed: async (raw: unknown) => {
            const { taskId } = tasksRpcContract.activityFeed.input.parse(raw);
            const comments = rows(
              await rpc.listComments!({ taskId }),
              "comments",
            );
            return {
              entries: await Promise.all(
                comments.map(async (comment) => {
                  const row = rpcInput(comment);
                  return {
                    comment,
                    attachments:
                      row.kind === "system" || !rpc.listAttachments
                        ? []
                        : rows(
                            await rpc.listAttachments({ commentId: row.id }),
                            "attachments",
                          ),
                  };
                }),
              ),
            };
          },
        }
      : {}),
  };
}
