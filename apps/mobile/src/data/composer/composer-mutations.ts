import type { PromptDraftAttachment } from "@bb/client-core";
import { useMutation } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  buildAttachmentUploadRequest,
  parseUploadedAttachment,
  type PickedAttachmentFile,
} from "./attachment-upload";
import { postMultipart } from "./multipart-upload";
import {
  buildVoiceTranscriptionRequest,
  parseVoiceTranscription,
  type VoiceRecordingFile,
} from "./voice-transcription";

export interface UploadAttachmentVariables {
  file: PickedAttachmentFile;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/**
 * `POST /projects/:id/attachments` (one `file` field, streamed from the
 * picked URI). Failures toast globally ("Failed to attach file" + the
 * server's message, e.g. the size limit).
 */
export function useUploadAttachment(projectId: string | null) {
  const { serverUrl } = useProfileClient();
  return useMutation<PromptDraftAttachment, Error, UploadAttachmentVariables>({
    mutationFn: async ({ file, signal, onProgress }) => {
      if (projectId === null) {
        throw new Error("Pick a project before attaching files.");
      }
      const body = await postMultipart<unknown>(
        buildAttachmentUploadRequest({ serverUrl, projectId, file }),
        { signal, onUploadProgress: onProgress },
      );
      return parseUploadedAttachment(body);
    },
    meta: { errorMessage: "Failed to attach file" },
  });
}

export interface TranscribeVoiceVariables {
  file: VoiceRecordingFile;
  /** Text before the caret, sent as transcription context. */
  prompt?: string;
  signal?: AbortSignal;
}

/**
 * `POST /system/voice-transcription` (multipart `file` + optional `prompt`).
 * The voice controller renders its own error state, so the global toast is
 * opted out here and the controller toasts the mapped message itself.
 */
export function useVoiceTranscription() {
  const { serverUrl } = useProfileClient();
  return useMutation<string, Error, TranscribeVoiceVariables>({
    mutationFn: async ({ file, prompt, signal }) => {
      const body = await postMultipart<unknown>(
        buildVoiceTranscriptionRequest({ serverUrl, file, prompt }),
        { signal },
      );
      return parseVoiceTranscription(body);
    },
    meta: { showErrorToast: false },
  });
}
