import {
  pluginListingConsumeNoticeResponseSchema,
  pluginListingListResponseSchema,
  pluginListingMutationResponseSchema,
  pluginListingRecordSubmissionRequestSchema,
  pluginListingSaveDraftRequestSchema,
  type PluginListingDraftEntry,
  type PluginListingListResponse,
  type PluginListingRecord,
} from "@bb/server-contract";
import { z } from "zod";
import type { CreateSdkAreaArgs } from "./common.js";

export interface PluginListingSaveDraftArgs {
  pluginId: string;
  entry: PluginListingDraftEntry;
}

export interface PluginListingRecordSubmissionArgs {
  pluginId: string;
  pullRequestUrl: string;
}

export interface PluginListingListArgs {
  signal?: AbortSignal;
}

export interface PluginListingConsumeNoticeArgs {
  noticeId: string;
}

export interface PluginListingsArea {
  list(args?: PluginListingListArgs): Promise<PluginListingListResponse>;
  saveDraft(args: PluginListingSaveDraftArgs): Promise<PluginListingRecord>;
  recordSubmission(
    args: PluginListingRecordSubmissionArgs,
  ): Promise<PluginListingRecord>;
  consumeNotice(args: PluginListingConsumeNoticeArgs): Promise<boolean>;
}

export function createPluginListingsArea(
  args: CreateSdkAreaArgs,
): PluginListingsArea {
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init?: RequestInit,
  ): Promise<T> {
    const url = args.transport.baseUrl
      ? `${args.transport.baseUrl.replace(/\/$/u, "")}${path}`
      : path;
    const response = await args.transport.resolve(
      args.transport.fetch(url, init),
    );
    return schema.parse(await response.json());
  }

  function jsonRequest(body: object): RequestInit {
    return {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  function pluginPath(pluginId: string): string {
    return `/api/v1/plugins/${encodeURIComponent(z.string().min(1).parse(pluginId))}/listing`;
  }

  return {
    list: (input) =>
      request("/api/v1/plugin-listings", pluginListingListResponseSchema, {
        signal: input?.signal,
      }),
    async saveDraft(input) {
      const body = pluginListingSaveDraftRequestSchema.parse({
        entry: input.entry,
      });
      return (
        await request(
          `${pluginPath(input.pluginId)}/draft`,
          pluginListingMutationResponseSchema,
          jsonRequest(body),
        )
      ).record;
    },
    async recordSubmission(input) {
      const body = pluginListingRecordSubmissionRequestSchema.parse({
        pullRequestUrl: input.pullRequestUrl,
      });
      return (
        await request(
          `${pluginPath(input.pluginId)}/submission`,
          pluginListingMutationResponseSchema,
          jsonRequest(body),
        )
      ).record;
    },
    async consumeNotice(input) {
      const noticeId = z.string().min(1).parse(input.noticeId);
      return (
        await request(
          `/api/v1/plugin-listings/notices/${encodeURIComponent(noticeId)}/consume`,
          pluginListingConsumeNoticeResponseSchema,
          jsonRequest({}),
        )
      ).consumed;
    },
  };
}
