import type { BbPluginApi, JsonObject } from "@get-bb/plugin-sdk";
import { isAbsolute } from "node:path";
import {
  accountStatusSchema,
  arcListResponseSchema,
  arcMethods,
  arcResultSchema,
  type ArcCreateInput,
  type ArcDestroyInput,
  type ArcLifecycleInput,
  type ArcReadInput,
  type ArcRouting,
  type ArcSpawnThreadInput,
} from "./arcs.js";

type ThreadSpawnRequest = Parameters<
  BbPluginApi["sdk"]["threads"]["spawn"]
>[0];

function threadEnvironment(
  input: ArcSpawnThreadInput,
): ThreadSpawnRequest["environment"] {
  if (input.hostId !== undefined && input.environmentId !== undefined) {
    throw new Error("hostId and environmentId are mutually exclusive");
  }
  if (input.environmentId !== undefined) {
    return { type: "reuse", environmentId: input.environmentId };
  }
  if (input.hostId === undefined) {
    return { type: "project-default" };
  }
  if (
    input.hostId.trim().length === 0 ||
    input.cwd === undefined ||
    input.cwd.trim().length === 0 ||
    input.cwd.includes("\0") ||
    !isAbsolute(input.cwd)
  ) {
    throw new Error(
      "explicit Arc host routing requires a non-empty hostId and an absolute cwd",
    );
  }
  return {
    type: "host",
    hostId: input.hostId,
    workspace: { type: "unmanaged", path: input.cwd },
  };
}

export function arcThreadSpawnRequest(
  input: ArcSpawnThreadInput,
): ThreadSpawnRequest {
  return {
    projectId: input.projectId,
    providerId: input.providerId,
    prompt: input.prompt,
    ...(input.title === undefined ? {} : { title: input.title }),
    executionInputSources: { providerId: "explicit" },
    providerSessionOptions: { arc: { arcId: input.arcId } },
    environment: threadEnvironment(input),
  };
}

export class ArcService {
  public constructor(private readonly bb: Pick<BbPluginApi, "sdk">) {}

  private async call<T>(
    routing: ArcRouting,
    method: string,
    params: JsonObject,
    schema: { parse(value: unknown): T },
  ): Promise<T> {
    const base = {
      providerId: routing.providerId,
      method,
      params,
      ...(routing.cwd === undefined ? {} : { cwd: routing.cwd }),
    };
    const result =
      routing.hostId === undefined
        ? routing.environmentId === undefined
          ? await this.bb.sdk.providers.experimental_extension(base)
          : await this.bb.sdk.providers.experimental_extension({
              ...base,
              environmentId: routing.environmentId,
            })
        : await this.bb.sdk.providers.experimental_extension({
            ...base,
            hostId: routing.hostId,
          });
    return schema.parse(result);
  }

  public accountStatus(routing: ArcRouting) {
    return this.call(
      routing,
      arcMethods.accountStatus,
      {},
      accountStatusSchema,
    );
  }

  public authorize(routing: ArcRouting) {
    return this.call(
      routing,
      arcMethods.accountAuthorize,
      {},
      accountStatusSchema,
    );
  }

  public list(routing: ArcRouting) {
    return this.call(
      routing,
      arcMethods.list,
      { hostId: "" },
      arcListResponseSchema,
    ).then((result) => result.data);
  }

  public async overview(routing: ArcRouting) {
    const account = await this.accountStatus(routing);
    const arcs = account.state === "connected" ? await this.list(routing) : [];
    return { account, arcs };
  }

  public read(input: ArcReadInput) {
    return this.call(
      input,
      arcMethods.read,
      { arcId: input.arcId },
      arcResultSchema,
    );
  }

  public create(input: ArcCreateInput) {
    const { providerId, hostId, environmentId, cwd, ...params } = input;
    return this.call(
      { providerId, hostId, environmentId, cwd },
      arcMethods.create,
      params,
      arcResultSchema,
    );
  }

  public lifecycle(input: ArcLifecycleInput) {
    const { providerId, hostId, environmentId, cwd, arcId, action } = input;
    return this.call(
      { providerId, hostId, environmentId, cwd },
      arcMethods[action],
      { arcId },
      arcResultSchema,
    );
  }

  public destroy(input: ArcDestroyInput) {
    const { providerId, hostId, environmentId, cwd, arcId } = input;
    return this.call(
      { providerId, hostId, environmentId, cwd },
      arcMethods.destroy,
      { arcId },
      {
        parse(value: unknown) {
          if (
            typeof value !== "object" ||
            value === null ||
            !("arcId" in value) ||
            typeof value.arcId !== "string"
          ) {
            throw new Error("invalid Arc destroy response");
          }
          return { arcId: value.arcId };
        },
      },
    );
  }

  public async spawnThread(
    input: ArcSpawnThreadInput,
  ): Promise<{ threadId: string }> {
    const result = await this.bb.sdk.threads.spawn(
      arcThreadSpawnRequest(input),
    );
    return { threadId: result.id };
  }
}
