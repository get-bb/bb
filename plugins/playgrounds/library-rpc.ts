import { z } from "zod";
import { idSchema, threadSchema } from "./model.js";
import { catalogIdSchema } from "./catalog-format.js";
import type { Library } from "./library.js";
import type { Catalog } from "./catalog.js";

const requestId = z.string().max(64).optional();
const appRef = { appId: idSchema, versionId: idSchema.optional() };
const revision = z.number().int().min(0);
const out = <T>() => z.custom<T>(() => true);
type R<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;
const draftEdit = z
  .object({
    packageText: z.string().max(5_000_000).optional(),
    html: z.string().max(400_000).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    summary: z.string().max(400).optional(),
    width: z.number().int().min(320).max(1200).nullable().optional(),
    documentJson: z.string().max(120_000).optional(),
    actionsJson: z.string().max(200_000).optional(),
    fromAnswer: z
      .object({ answerId: idSchema, threadId: threadSchema })
      .strict()
      .optional(),
  })
  .strict();

export const libraryRpc = {
  appsList: {
    input: z
      .object({
        query: z.string().max(200).optional(),
        trashed: z.boolean().optional(),
      })
      .strict(),
    output: out<R<Library["list"]>>(),
  },
  appsDescribe: {
    input: z.object(appRef).strict(),
    output: out<R<Library["describe"]>>(),
  },
  appsSource: {
    input: z.object(appRef).strict(),
    output: out<R<Library["source"]>>(),
  },
  appsSave: {
    input: z
      .object({
        answerId: idSchema,
        threadId: threadSchema,
        name: z.string().trim().min(1).max(160).optional(),
        description: z.string().max(400).optional(),
        requestId,
      })
      .strict(),
    output: out<R<Library["save"]>>(),
  },
  appsImport: {
    input: z
      .object({
        text: z.string().max(5_000_000),
        name: z.string().trim().min(1).max(160).optional(),
        requestId,
      })
      .strict(),
    output: out<R<Library["importPackage"]>>(),
  },
  appsExport: {
    input: z.object(appRef).strict(),
    output: out<R<Library["exportVersion"]>>(),
  },
  appsUpdate: {
    input: z
      .object({
        appId: idSchema,
        expectedRevision: revision,
        name: z.string().trim().min(1).max(160).optional(),
        description: z.string().max(400).optional(),
        selectedVersionId: idSchema.optional(),
      })
      .strict(),
    output: out<R<Library["update"]>>(),
  },
  appsCreateVersion: {
    input: z
      .object({
        appId: idSchema,
        expectedRevision: revision,
        label: z.string().max(40).optional(),
        packageText: z.string().max(5_000_000).optional(),
        answerId: idSchema.optional(),
        threadId: threadSchema.optional(),
        requestId,
      })
      .strict(),
    output: out<R<Library["createVersion"]>>(),
  },
  appsRemix: {
    input: z
      .object({
        appId: idSchema,
        versionId: idSchema.optional(),
        name: z.string().trim().min(1).max(160).optional(),
        requestId,
      })
      .strict(),
    output: out<R<Library["remix"]>>(),
  },
  appsTrash: {
    input: z.object({ appId: idSchema }).strict(),
    output: out<R<Library["trash"]>>(),
  },
  appsRestore: {
    input: z.object({ appId: idSchema }).strict(),
    output: out<R<Library["restore"]>>(),
  },
  appsPurge: {
    input: z.object({ appId: idSchema, confirm: z.literal(true) }).strict(),
    output: out<R<Library["purge"]>>(),
  },
  appsOpen: {
    input: z
      .object({
        appId: idSchema,
        threadId: threadSchema,
        fresh: z.boolean(),
        requestId,
      })
      .strict(),
    output: out<R<Library["open"]>>(),
  },
  appsRunInfo: {
    input: z.object({ runId: idSchema, threadId: threadSchema }).strict(),
    output: out<R<Library["runInfo"]>>(),
  },
  appsClients: {
    input: z.object({ runId: idSchema, threadId: threadSchema }).strict(),
    output: out<R<Library["clients"]>>(),
  },
  appsInvoke: {
    input: z
      .object({
        runId: idSchema,
        threadId: threadSchema,
        action: z.string().min(1).max(80),
        args: z.array(z.unknown()).max(16),
        clientId: z.string().min(8).max(64).optional(),
        requestId: z.string().max(64),
      })
      .strict(),
    output: out<R<Library["invoke"]>>(),
  },
  draftGet: {
    input: z.object({ appId: idSchema }).strict(),
    output: out<R<Library["draftGet"]>>(),
  },
  draftOpen: {
    input: z.object(appRef).strict(),
    output: out<R<Library["draftOpen"]>>(),
  },
  draftWrite: {
    input: z
      .object({ appId: idSchema, expectedRevision: revision, edit: draftEdit })
      .strict(),
    output: out<R<Library["draftWrite"]>>(),
  },
  draftDiscard: {
    input: z.object({ appId: idSchema, expectedRevision: revision }).strict(),
    output: out<R<Library["draftDiscard"]>>(),
  },
  draftPreview: {
    input: z
      .object({ appId: idSchema, threadId: threadSchema, requestId })
      .strict(),
    output: out<R<Library["draftPreview"]>>(),
  },
  releasePrepare: {
    input: z
      .object({
        appId: idSchema,
        expectedDraftRevision: revision.optional(),
        version: z.string().max(40).optional(),
        changelog: z.string().max(1000),
        catalogId: catalogIdSchema.optional(),
        author: z
          .object({
            name: z.string().trim().min(1).max(80),
            url: z.string().url().startsWith("https://").max(300).optional(),
          })
          .strict()
          .optional(),
        license: z.string().max(64).optional(),
        reviewed: z.boolean(),
        requestId,
      })
      .strict(),
    output: out<R<Library["releasePrepare"]>>(),
  },
  releaseShow: {
    input: z.object({ releaseId: idSchema }).strict(),
    output: out<R<Library["releaseShow"]>>(),
  },
  releasePackage: {
    input: z.object({ releaseId: idSchema }).strict(),
    output: out<R<Library["releasePackage"]>>(),
  },
  releaseList: {
    input: z.object({ appId: idSchema }).strict(),
    output: out<R<Library["releaseList"]>>(),
  },
  releaseRefresh: {
    input: z.object({ releaseId: idSchema }).strict(),
    output: out<R<Library["releaseRefresh"]>>(),
  },
  releaseSubmitted: {
    input: z
      .object({ releaseId: idSchema, prUrl: z.string().max(300) })
      .strict(),
    output: out<R<Library["releaseRecordSubmission"]>>(),
  },
  releaseFailed: {
    input: z
      .object({ releaseId: idSchema, note: z.string().max(500) })
      .strict(),
    output: out<R<Library["releaseMarkFailed"]>>(),
  },
  communityList: {
    input: z
      .object({
        query: z.string().max(200).optional(),
        refreshIfStale: z.boolean().optional(),
      })
      .strict(),
    output: out<R<Catalog["list"]>>(),
  },
  communityRefresh: {
    input: z.object({}).strict(),
    output: out<R<Catalog["refresh"]>>(),
  },
  communityInspect: {
    input: z
      .object({
        catalogId: catalogIdSchema,
        version: z.string().max(40).optional(),
      })
      .strict(),
    output: out<R<Catalog["inspect"]>>(),
  },
  communityAdd: {
    input: z
      .object({
        catalogId: catalogIdSchema,
        version: z.string().max(40).optional(),
        requestId,
      })
      .strict(),
    output: out<R<Catalog["add"]>>(),
  },
};

export function libraryHandlers(library: Library, catalog: Catalog) {
  return {
    appsList: (input: { query?: string; trashed?: boolean }) =>
      library.list(input),
    appsDescribe: (input: { appId: string; versionId?: string }) =>
      library.describe(input),
    appsSource: (input: { appId: string; versionId?: string }) =>
      library.source(input),
    appsSave: library.save,
    appsImport: library.importPackage,
    appsExport: library.exportVersion,
    appsUpdate: library.update,
    appsCreateVersion: library.createVersion,
    appsRemix: library.remix,
    appsTrash: library.trash,
    appsRestore: library.restore,
    appsPurge: library.purge,
    appsOpen: library.open,
    appsRunInfo: library.runInfo,
    appsClients: library.clients,
    appsInvoke: library.invoke,
    draftGet: library.draftGet,
    draftOpen: library.draftOpen,
    draftWrite: library.draftWrite,
    draftDiscard: library.draftDiscard,
    draftPreview: library.draftPreview,
    releasePrepare: library.releasePrepare,
    releaseShow: library.releaseShow,
    releasePackage: library.releasePackage,
    releaseList: library.releaseList,
    releaseRefresh: library.releaseRefresh,
    releaseSubmitted: library.releaseRecordSubmission,
    releaseFailed: library.releaseMarkFailed,
    communityList: catalog.list,
    communityRefresh: () => catalog.refresh(),
    communityInspect: catalog.inspect,
    communityAdd: catalog.add,
  };
}
