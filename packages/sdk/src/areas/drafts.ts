import {
  draftCreateResponseSchema,
  draftDeleteResponseSchema,
  draftListResponseSchema,
  draftOpenResponseSchema,
  draftSchema,
  draftSubmitResponseSchema,
  type Draft,
  type DraftCreateRequest,
  type DraftCreateResponse,
  type DraftDeleteRequest,
  type DraftDeleteResponse,
  type DraftListResponse,
  type DraftOpenRequest,
  type DraftOpenResponse,
  type DraftSubmitRequest,
  type DraftSubmitResponse,
  type DraftUpdateRequest,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export type DraftOpenArgs = DraftOpenRequest & { draftId: string };
export type DraftOpenResult = DraftOpenResponse;
export type DraftCreateArgs = DraftCreateRequest;
export type DraftCreateResult = DraftCreateResponse;
export type DraftDeleteArgs = DraftDeleteRequest & { draftId: string };
export type DraftDeleteResult = DraftDeleteResponse;
export interface DraftGetArgs {
  draftId: string;
  signal?: AbortSignal;
}
export type DraftGetResult = Draft;
export interface DraftListArgs {
  projectId?: string;
  query?: string;
  includeEmpty?: boolean;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}
export type DraftListResult = DraftListResponse;
export type DraftUpdateArgs = DraftUpdateRequest & { draftId: string };
export type DraftUpdateResult = Draft;
export type DraftSubmitArgs = DraftSubmitRequest & { draftId: string };
export type DraftSubmitResult = DraftSubmitResponse;

export interface DraftsArea {
  open(args: DraftOpenArgs): Promise<DraftOpenResult>;
  create(args?: DraftCreateArgs): Promise<DraftCreateResult>;
  list(args?: DraftListArgs): Promise<DraftListResult>;
  get(args: DraftGetArgs): Promise<DraftGetResult>;
  update(args: DraftUpdateArgs): Promise<DraftUpdateResult>;
  delete(args: DraftDeleteArgs): Promise<DraftDeleteResult>;
  submit(args: DraftSubmitArgs): Promise<DraftSubmitResult>;
}

export function createDraftsArea(args: CreateSdkAreaArgs): DraftsArea {
  const { transport } = args;
  return {
    async open(input) {
      const { draftId, ...json } = input;
      const body = await transport.readJson(
        transport.api.v1.drafts[":id"].open.$post({
          param: { id: draftId },
          json,
        }),
      );
      return draftOpenResponseSchema.parse(body);
    },
    async create(input = {}) {
      const body = await transport.readJson(
        transport.api.v1.drafts.$post({ json: input }),
      );
      return draftCreateResponseSchema.parse(body);
    },
    async list(input) {
      const body = await transport.readJson(
        transport.api.v1.drafts.$get(
          {
            query: {
              ...(input?.projectId === undefined
                ? {}
                : { projectId: input.projectId }),
              ...(input?.query === undefined ? {} : { query: input.query }),
              ...(input?.includeEmpty === undefined
                ? {}
                : { includeEmpty: input.includeEmpty ? "true" : "false" }),
              ...(input?.limit === undefined
                ? {}
                : { limit: String(input.limit) }),
              ...(input?.offset === undefined
                ? {}
                : { offset: String(input.offset) }),
            },
          },
          ...signalRequestArgs(input?.signal),
        ),
      );
      return draftListResponseSchema.parse(body);
    },
    async get(input) {
      const body = await transport.readJson(
        transport.api.v1.drafts[":id"].$get(
          { param: { id: input.draftId } },
          ...signalRequestArgs(input.signal),
        ),
      );
      return draftSchema.parse(body);
    },
    async update(input) {
      const { draftId, ...json } = input;
      const body = await transport.readJson(
        transport.api.v1.drafts[":id"].$patch({
          param: { id: draftId },
          json,
        }),
      );
      return draftSchema.parse(body);
    },
    async delete(input) {
      const { draftId, ...json } = input;
      const body = await transport.readJson(
        transport.api.v1.drafts[":id"].$delete({
          param: { id: draftId },
          json,
        }),
      );
      return draftDeleteResponseSchema.parse(body);
    },
    async submit(input) {
      const { draftId, ...json } = input;
      const body = await transport.readJson(
        transport.api.v1.drafts[":id"].submit.$post({
          param: { id: draftId },
          json,
        }),
      );
      return draftSubmitResponseSchema.parse(body);
    },
  };
}
