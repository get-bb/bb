import { requireNativeModule } from "expo-modules-core";
import { z } from "zod";

const sharedFileSchema = z.object({
  fileId: z.string().uuid(),
  fileName: z.string().min(1).max(180),
  kind: z.enum(["image", "video", "file"]),
  mimeType: z.string().min(1).max(200),
  path: z.string().min(1).max(240),
  processingError: z.string().max(500).optional(),
  sizeBytes: z.number().int().nonnegative(),
  uri: z.string().url(),
});

const pendingShareSchema = z.object({
  alreadyAcknowledged: z.boolean().optional(),
  claimScopeKey: z.string().uuid().optional(),
  createdAt: z.number().finite(),
  error: z.string().max(500).optional(),
  files: z.array(sharedFileSchema).max(20),
  id: z.string().uuid(),
  text: z.string().max(100_000),
});

export type PendingShare = z.infer<typeof pendingShareSchema>;

interface ShareInboxModule {
  acknowledgeShareForProject: (
    id: string,
    profileId: string,
    serverUrl: string,
    projectId: string,
  ) => Promise<void>;
  discardShare: (id: string) => Promise<void>;
  getShare: (
    id: string,
    profileId: string,
    serverUrl: string,
    projectId: string,
  ) => Promise<unknown>;
  getSharedUploadReceipt: (
    id: string,
    profileId: string,
    serverUrl: string,
    projectId: string,
    fileId: string,
  ) => Promise<unknown>;
  pendingShares: () => Promise<unknown>;
  prepareShare: (id: string) => Promise<unknown>;
  recordSharedUpload: (
    id: string,
    profileId: string,
    serverUrl: string,
    projectId: string,
    fileId: string,
    attachment: unknown,
  ) => Promise<void>;
}

let nativeModule: ShareInboxModule | null | undefined;

function getNativeModule(): ShareInboxModule | null {
  if (nativeModule !== undefined) return nativeModule;
  try {
    nativeModule = requireNativeModule<ShareInboxModule>("BBShareInbox");
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

export async function readPendingShares(): Promise<PendingShare[]> {
  const module = getNativeModule();
  if (module === null) return [];
  const parsed = z
    .array(pendingShareSchema)
    .max(100)
    .safeParse(await module.pendingShares());
  if (!parsed.success) throw new Error("The pending share data is invalid.");
  return parsed.data;
}

export async function preparePendingShare(id: string): Promise<PendingShare> {
  const module = getNativeModule();
  if (module === null)
    throw new Error("Shared items are unavailable in this app build.");
  const parsed = pendingShareSchema.safeParse(await module.prepareShare(id));
  if (!parsed.success) throw new Error("The prepared share data is invalid.");
  return parsed.data;
}

export async function getPendingShare(
  id: string,
  claim: { profileId: string; serverUrl: string; projectId: string },
): Promise<PendingShare> {
  const module = getNativeModule();
  if (module === null)
    throw new Error("Shared items are unavailable in this app build.");
  const parsed = pendingShareSchema.safeParse(
    await module.getShare(
      id,
      claim.profileId,
      claim.serverUrl,
      claim.projectId,
    ),
  );
  if (!parsed.success) throw new Error("The pending share data is invalid.");
  return parsed.data;
}

export async function getSharedUploadReceipt(
  id: string,
  profileId: string,
  serverUrl: string,
  projectId: string,
  fileId: string,
): Promise<unknown> {
  const module = getNativeModule();
  if (module === null)
    throw new Error("Shared items are unavailable in this app build.");
  return module.getSharedUploadReceipt(
    id,
    profileId,
    serverUrl,
    projectId,
    fileId,
  );
}

export async function acknowledgeShareForProject(
  id: string,
  profileId: string,
  serverUrl: string,
  projectId: string,
): Promise<void> {
  const module = getNativeModule();
  if (module === null)
    throw new Error("Shared items are unavailable in this app build.");
  await module.acknowledgeShareForProject(id, profileId, serverUrl, projectId);
}

export async function recordSharedUpload(
  id: string,
  profileId: string,
  serverUrl: string,
  projectId: string,
  fileId: string,
  attachment: unknown,
): Promise<void> {
  const module = getNativeModule();
  if (module === null)
    throw new Error("Shared items are unavailable in this app build.");
  await module.recordSharedUpload(
    id,
    profileId,
    serverUrl,
    projectId,
    fileId,
    attachment,
  );
}

export async function discardPendingShare(id: string): Promise<void> {
  const module = getNativeModule();
  if (module === null)
    throw new Error("Shared items are unavailable in this app build.");
  await module.discardShare(id);
}
