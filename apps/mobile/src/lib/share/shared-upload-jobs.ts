import type { SharedUploadStatus } from "@bb/mobile-bridge";
import type { ProjectAttachmentNativeFile } from "@bb/sdk/browser";
import type { ServerProfile } from "@/lib/profiles";
import { uploadedPromptAttachmentSchema } from "@bb/server-contract";
import { PROMPT_ATTACHMENT_MAX_BYTES } from "@bb/domain";
import {
  acknowledgeShareForProject,
  getPendingShare,
  getSharedUploadReceipt,
  preparePendingShare,
  recordSharedUpload,
} from "./share-inbox";
import { getAppProfileClientRegistry } from "@/app-shell/client-registry";

const jobs = new Map<string, SharedUploadStatus>();
const jobKeys = new Map<string, string>();
const preparations = new Map<
  string,
  Promise<Awaited<ReturnType<typeof preparePendingShare>>>
>();

async function prepareShareOnce(shareId: string) {
  let preparation = preparations.get(shareId);
  if (!preparation) {
    preparation = preparePendingShare(shareId);
    preparations.set(shareId, preparation);
  }
  try {
    return await preparation;
  } finally {
    if (preparations.get(shareId) === preparation) preparations.delete(shareId);
  }
}

function scopeKey(
  profile: ServerProfile,
  projectId: string,
  shareId: string,
  fileId: string,
): string {
  return [profile.id, profile.serverUrl, projectId, shareId, fileId].join(
    "\u0000",
  );
}

function attachmentRecord(value: unknown): SharedUploadStatus["attachment"] {
  const parsed = uploadedPromptAttachmentSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("The server returned invalid attachment data.");
  return parsed.data;
}

export async function readSharedContent(
  profile: ServerProfile,
  shareId: string,
  projectId: string,
) {
  const share = await getPendingShare(shareId, {
    profileId: profile.id,
    serverUrl: profile.serverUrl,
    projectId,
  });
  if (!share.claimScopeKey)
    throw new Error(
      "The mobile app could not establish the share destination.",
    );
  return {
    claimScopeKey: share.claimScopeKey,
    ...(share.alreadyAcknowledged ? { alreadyAcknowledged: true } : {}),
    shareId: share.id,
    text: share.text,
    files: share.files.map(
      ({ fileId, fileName, kind, mimeType, sizeBytes, processingError }) => ({
        fileId,
        fileName,
        kind,
        mimeType,
        sizeBytes,
        ...(processingError ? { processingError } : {}),
      }),
    ),
  };
}

export function startSharedUpload(
  profile: ServerProfile,
  shareId: string,
  fileId: string,
  projectId: string,
): { jobId: string } {
  const key = scopeKey(profile, projectId, shareId, fileId);
  const existing = jobKeys.get(key);
  if (existing && readSharedUploadStatus(profile, existing).status !== "failed")
    return { jobId: existing };
  const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  jobKeys.set(key, jobId);
  jobs.set(jobId, { jobId, status: "queued" });
  void runUpload(profile, shareId, fileId, projectId, jobId);
  return { jobId };
}

async function runUpload(
  profile: ServerProfile,
  shareId: string,
  fileId: string,
  projectId: string,
  jobId: string,
): Promise<void> {
  jobs.set(jobId, { jobId, status: "uploading" });
  try {
    const prepared = await prepareShareOnce(shareId);
    const file = prepared.files.find((entry) => entry.fileId === fileId);
    if (!file) throw new Error("The shared file is no longer available.");
    if (file.processingError) throw new Error(file.processingError);
    if (file.sizeBytes > PROMPT_ATTACHMENT_MAX_BYTES)
      throw new Error(
        `${file.fileName} is larger than the 35 MiB attachment limit.`,
      );
    const client = getAppProfileClientRegistry().getClientForProfile(profile);
    const rawPrevious = await getSharedUploadReceipt(
      shareId,
      profile.id,
      profile.serverUrl,
      projectId,
      fileId,
    );
    const previous =
      rawPrevious === null ? null : attachmentRecord(rawPrevious);
    const attachment =
      previous ??
      attachmentRecord(
        await client.sdk.projects.attachments.upload({
          clientFile: {
            nativeFile: true,
            uri: file.uri,
            name: file.fileName,
            mimeType: file.mimeType,
          } satisfies ProjectAttachmentNativeFile,
          filename: file.fileName,
          mimeType: file.mimeType,
          projectId,
        }),
      );
    await recordSharedUpload(
      shareId,
      profile.id,
      profile.serverUrl,
      projectId,
      fileId,
      attachment,
    );
    jobs.set(jobId, { jobId, status: "complete", attachment });
  } catch (error) {
    jobs.set(jobId, {
      jobId,
      status: "failed",
      error:
        error instanceof Error
          ? error.message.slice(0, 1000)
          : String(error).slice(0, 1000),
    });
  }
}

export function readSharedUploadStatus(
  profile: ServerProfile,
  jobId: string,
): SharedUploadStatus {
  const status = jobs.get(jobId);
  if (!status)
    return {
      jobId,
      status: "failed",
      error: "This upload job has expired. Retry the share.",
    };
  const key = [...jobKeys].find(([, value]) => value === jobId)?.[0];
  if (!key?.startsWith(`${profile.id}\u0000${profile.serverUrl}\u0000`))
    return {
      jobId,
      status: "failed",
      error: "This upload job belongs to another server.",
    };
  return status;
}

export async function acknowledgeSharedContent(
  profile: ServerProfile,
  shareId: string,
  projectId: string,
): Promise<{ acknowledged: true }> {
  await acknowledgeShareForProject(
    shareId,
    profile.id,
    profile.serverUrl,
    projectId,
  );
  forgetSharedUploadJobsForShare(shareId);
  return { acknowledged: true };
}

export function forgetSharedUploadJobsForShare(shareId: string): void {
  for (const [key, jobId] of jobKeys) {
    if (!key.split("\u0000").includes(shareId)) continue;
    jobKeys.delete(key);
    jobs.delete(jobId);
  }
}
