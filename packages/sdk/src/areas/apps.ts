import {
  appDataReadResponseSchema,
  type AddAppSourceRequest,
  type AppDataEntry,
  type AppDataListResponse,
  type AppDetail,
  type AppMessageRequest,
  type AppSourceStatus,
  type AppSummary,
  type BbDataChangeCallback,
  type BbDataChangeEvent,
  type BbDataDeleteArgs,
  type BbDataEntry,
  type BbDataListArgs,
  type BbDataOnChangeArgs,
  type BbDataReadArgs,
  type BbDataWriteArgs,
  type BbMessageSendArgs,
  type CreateAppRequest,
} from "@bb/server-contract";
import type { AppDataPath, JsonValue } from "@bb/domain";
import { BbHttpError } from "../response.js";
import { fetchApi } from "../transport-http.js";
import type { BbRealtime } from "../realtime.js";
import type { CreateSdkAreaArgs, OkResponse } from "./common.js";
import { requireCurrentApplicationId } from "./common.js";

export interface AppGetArgs {
  applicationId: string;
}

export interface AppCreateArgs extends CreateAppRequest {}

export interface AppDeleteArgs {
  applicationId: string;
}

export interface AppDetachArgs {
  applicationId: string;
}

export interface AppSourceAddArgs extends AddAppSourceRequest {}

export interface AppSourceSyncArgs {
  name: string;
  /** Required so every caller states intent — matches the server contract. */
  force: boolean;
}

export interface AppSourceRemoveArgs {
  name: string;
}

export interface AppOpenUrlArgs {
  applicationId: string;
  targetThreadId?: string;
}

export interface AppDataListArgs {
  applicationId: string;
  prefix?: AppDataPath | "";
}

export interface AppDataReadArgs {
  applicationId: string;
  path: AppDataPath;
}

export interface AppDataWriteArgs extends AppDataReadArgs {
  value: JsonValue;
}

export interface AppDataDeleteArgs extends AppDataReadArgs {}

export interface AppMessageArgs {
  applicationId: string;
  appSessionToken?: string;
  payload: JsonValue;
  targetThreadId?: string;
}

export interface CurrentAppRuntimeContext {
  applicationId: string;
  appDataPath?: string;
  appRootPath?: string;
  appsRootPath?: string;
}

export type CurrentAppDataReadArgs = BbDataReadArgs;
export type CurrentAppDataWriteArgs = BbDataWriteArgs;
export type CurrentAppDataDeleteArgs = BbDataDeleteArgs;
export type CurrentAppDataListArgs = BbDataListArgs;
export type CurrentAppDataEntry = BbDataEntry;
export type CurrentAppDataChangeEvent = BbDataChangeEvent;
export type CurrentAppDataChangeCallback = BbDataChangeCallback;
export type CurrentAppDataChangeArgs = BbDataOnChangeArgs;
export type CurrentAppMessageSendArgs = BbMessageSendArgs;

export interface AppsDataArea {
  delete(args: AppDataDeleteArgs): Promise<OkResponse>;
  list(args: AppDataListArgs): Promise<AppDataListResponse>;
  read(args: AppDataReadArgs): Promise<AppDataEntry | undefined>;
  write(args: AppDataWriteArgs): Promise<AppDataEntry>;
}

export interface AppSourcesArea {
  add(args: AppSourceAddArgs): Promise<AppSourceStatus>;
  list(): Promise<AppSourceStatus[]>;
  remove(args: AppSourceRemoveArgs): Promise<OkResponse>;
  sync(args: AppSourceSyncArgs): Promise<AppSourceStatus>;
}

export interface AppsArea {
  create(args: AppCreateArgs): Promise<AppDetail>;
  current(): Promise<CurrentAppRuntimeContext>;
  data: AppsDataArea;
  delete(args: AppDeleteArgs): Promise<OkResponse>;
  detach(args: AppDetachArgs): Promise<OkResponse>;
  get(args: AppGetArgs): Promise<AppDetail>;
  list(): Promise<AppSummary[]>;
  message(args: AppMessageArgs): Promise<OkResponse>;
  openUrl(args: AppOpenUrlArgs): string;
  sources: AppSourcesArea;
}

export interface CurrentAppDataArea {
  delete(args: CurrentAppDataDeleteArgs): Promise<void>;
  entries(args?: CurrentAppDataListArgs): Promise<AppDataEntry[]>;
  list(args?: CurrentAppDataListArgs): Promise<CurrentAppDataEntry[]>;
  onChange(args: CurrentAppDataChangeArgs): () => void;
  read(args: CurrentAppDataReadArgs): Promise<JsonValue | undefined>;
  write(args: CurrentAppDataWriteArgs): Promise<void>;
}

export interface CurrentAppMessageArea {
  send(args: CurrentAppMessageSendArgs): Promise<void>;
}

export interface CreateCurrentAppDataAreaArgs extends CreateSdkAreaArgs {
  apps: AppsArea;
  realtime: BbRealtime;
}

const APP_MISSING_ERROR_CODE = "app_missing";

/**
 * A 404 from the app data route means the data path has no entry — unless the
 * server's error code says the application itself is missing, which callers
 * must see as a failure rather than an empty read.
 */
function isAppDataPathMissingError(error: unknown): boolean {
  return (
    error instanceof BbHttpError &&
    error.status === 404 &&
    error.code !== APP_MISSING_ERROR_CODE
  );
}

function encodePathSegments(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function appDataPath(args: AppDataReadArgs): string {
  return `/apps/${encodeURIComponent(args.applicationId)}/data/${encodePathSegments(
    args.path,
  )}`;
}

function appEntryPath(args: AppOpenUrlArgs): string {
  const path = `/api/v1/apps/${encodeURIComponent(args.applicationId)}/`;
  if (!args.targetThreadId) {
    return path;
  }
  return `${path}?targetThreadId=${encodeURIComponent(args.targetThreadId)}`;
}

export function createAppsArea(args: CreateSdkAreaArgs): AppsArea {
  const { transport } = args;
  const data: AppsDataArea = {
    async delete(input) {
      await transport.readVoid(
        fetchApi(
          {
            method: "DELETE",
            path: appDataPath(input),
            headers: { Accept: "application/json" },
          },
          transport,
        ),
      );
      return { ok: true };
    },
    async list(input) {
      return transport.readJson(
        transport.api.v1.apps[":applicationId"].data.$get({
          param: { applicationId: input.applicationId },
          query: input.prefix === undefined ? {} : { prefix: input.prefix },
        }),
      );
    },
    async read(input) {
      try {
        const response = await transport.resolve(
          fetchApi(
            {
              method: "GET",
              path: appDataPath(input),
              headers: { Accept: "application/json" },
            },
            transport,
          ),
        );
        return appDataReadResponseSchema.parse(await response.json());
      } catch (error) {
        if (isAppDataPathMissingError(error)) {
          return undefined;
        }
        throw error;
      }
    },
    async write(input) {
      const response = await transport.resolve(
        fetchApi(
          {
            method: "PUT",
            path: appDataPath(input),
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ value: input.value }),
          },
          transport,
        ),
      );
      return appDataReadResponseSchema.parse(await response.json());
    },
  };

  const sources: AppSourcesArea = {
    async add(input) {
      return transport.readJson(
        transport.api.v1["app-sources"].$post({ json: input }),
      );
    },
    async list() {
      return transport.readJson(transport.api.v1["app-sources"].$get());
    },
    async remove(input) {
      await transport.readVoid(
        transport.api.v1["app-sources"][":name"].$delete({
          param: { name: input.name },
        }),
      );
      return { ok: true };
    },
    async sync(input) {
      return transport.readJson(
        transport.api.v1["app-sources"][":name"].sync.$post({
          param: { name: input.name },
          json: { force: input.force },
        }),
      );
    },
  };

  return {
    async create(input) {
      return transport.readJson(
        transport.api.v1.apps.$post({
          json: input,
        }),
      );
    },
    async current() {
      return {
        applicationId: requireCurrentApplicationId(args.context),
        appDataPath: args.context.appDataPath,
        appRootPath: args.context.appRootPath,
        appsRootPath: args.context.appsRootPath,
      };
    },
    data,
    async delete(input) {
      await transport.readVoid(
        transport.api.v1.apps[":applicationId"].$delete({
          param: { applicationId: input.applicationId },
        }),
      );
      return { ok: true };
    },
    async detach(input) {
      await transport.readVoid(
        transport.api.v1.apps[":applicationId"].detach.$post({
          param: { applicationId: input.applicationId },
        }),
      );
      return { ok: true };
    },
    async get(input) {
      return transport.readJson(
        transport.api.v1.apps[":applicationId"].$get({
          param: { applicationId: input.applicationId },
        }),
      );
    },
    async list() {
      return transport.readJson(transport.api.v1.apps.$get());
    },
    async message(input) {
      const json: AppMessageRequest = {
        payload: input.payload,
        ...(input.appSessionToken ? { appSessionToken: input.appSessionToken } : {}),
        ...(input.targetThreadId ? { targetThreadId: input.targetThreadId } : {}),
      };
      await transport.readVoid(
        transport.api.v1.apps[":applicationId"].message.$post({
          param: { applicationId: input.applicationId },
          json,
        }),
      );
      return { ok: true };
    },
    openUrl(input) {
      return appEntryPath(input);
    },
    sources,
  };
}

export function createCurrentAppDataArea(
  args: CreateCurrentAppDataAreaArgs,
): CurrentAppDataArea {
  const { apps } = args;
  const applicationId = () => requireCurrentApplicationId(args.context);
  const entries = async (input: CurrentAppDataListArgs = {}) => {
    const response = await apps.data.list({
      applicationId: applicationId(),
      prefix: input.prefix,
    });
    return response.entries;
  };

  return {
    async delete(input) {
      await apps.data.delete({
        applicationId: applicationId(),
        path: input.path,
      });
    },
    entries,
    async list(input = {}) {
      const appDataEntries = await entries(input);
      return appDataEntries.map((entry) => ({
        path: entry.path,
        value: entry.value,
      }));
    },
    onChange(input) {
      return args.realtime.on({
        event: "app-data:changed",
        applicationId: applicationId(),
        ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
        callback(event) {
          // The realtime dispatcher already delivers a per-listener clone;
          // no defensive re-clone needed here.
          input.callback({
            path: event.path,
            value: event.deleted ? undefined : event.value,
            deleted: event.deleted,
          });
        },
      });
    },
    async read(input) {
      const entry = await apps.data.read({
        applicationId: applicationId(),
        path: input.path,
      });
      return entry?.value;
    },
    async write(input) {
      await apps.data.write({
        applicationId: applicationId(),
        path: input.path,
        value: input.value,
      });
    },
  };
}

export function createCurrentAppMessageArea(
  args: CreateSdkAreaArgs,
): CurrentAppMessageArea {
  const apps = createAppsArea(args);
  return {
    async send(input) {
      await apps.message({
        applicationId: requireCurrentApplicationId(args.context),
        appSessionToken: args.context.appSessionToken,
        payload: input.payload,
        targetThreadId: input.targetThreadId ?? args.context.targetThreadId,
      });
    },
  };
}
