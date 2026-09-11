import {
  draftCreateResponseSchema,
  draftDeleteResponseSchema,
  draftListResponseSchema,
  draftSchema,
  draftSubmitResponseSchema,
  type Draft,
  type DraftContent,
  type DraftCreateResponse,
  type DraftListQuery,
  type DraftSubmitResponse,
} from "@bb/server-contract";
import { allDraftQueryKeyPrefix } from "@/hooks/queries/query-keys";
import { HttpError, request, requestOptions } from "../api";
import { apiClient } from "../api-server";

export const draftResourceQueryKey = (id: string) =>
  [...allDraftQueryKeyPrefix(), "detail", id] as const;

export const draftResourceListQueryKey = (query: DraftListQuery) =>
  [...allDraftQueryKeyPrefix(), "list", query] as const;

export interface DraftResourceApi {
  get(id: string, signal?: AbortSignal): Promise<Draft | null>;
  create(id: string, content: DraftContent): Promise<DraftCreateResponse>;
  update(
    id: string,
    expectedRevision: number,
    content: DraftContent,
  ): Promise<Draft>;
  delete(id: string, expectedRevision: number): Promise<void>;
  submit(id: string, expectedRevision: number): Promise<DraftSubmitResponse>;
}

export function isDraftGoneError(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    (error.status === 404 ||
      (error.status === 410 && error.code === "draft_gone"))
  );
}

export const draftResourceApi: DraftResourceApi = {
  async get(id, signal) {
    try {
      return draftSchema.parse(
        await request(
          apiClient.drafts[":id"].$get(
            { param: { id } },
            requestOptions(signal),
          ),
        ),
      );
    } catch (error) {
      if (isDraftGoneError(error)) return null;
      throw error;
    }
  },
  async create(id, content) {
    return draftCreateResponseSchema.parse(
      await request(apiClient.drafts.$post({ json: { id, content } })),
    );
  },
  async update(id, expectedRevision, content) {
    return draftSchema.parse(
      await request(
        apiClient.drafts[":id"].$patch({
          param: { id },
          json: { expectedRevision, content },
        }),
      ),
    );
  },
  async delete(id, expectedRevision) {
    draftDeleteResponseSchema.parse(
      await request(
        apiClient.drafts[":id"].$delete({
          param: { id },
          json: { expectedRevision },
        }),
      ),
    );
  },
  async submit(id, expectedRevision) {
    return draftSubmitResponseSchema.parse(
      await request(
        apiClient.drafts[":id"].submit.$post({
          param: { id },
          json: { expectedRevision, origin: "app" },
        }),
      ),
    );
  },
};

export async function listDraftResources(
  query: DraftListQuery,
  signal?: AbortSignal,
) {
  return draftListResponseSchema.parse(
    await request(apiClient.drafts.$get({ query }, requestOptions(signal))),
  );
}
