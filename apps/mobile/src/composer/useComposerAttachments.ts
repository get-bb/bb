import type { PromptDraftAttachment } from "@bb/client-core";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useRef, useState } from "react";
import {
  fallbackAttachmentName,
  useUploadAttachment,
  validateAttachmentSize,
  type PickedAttachmentFile,
} from "@/data/composer";
import { toast } from "@/ui";

export interface PendingAttachment {
  id: string;
  name: string;
  /** Local preview for images while the upload runs. */
  previewUri: string | null;
  progress: number;
}

export interface UseComposerAttachmentsArgs {
  projectId: string | null;
  attachments: readonly PromptDraftAttachment[];
  onAttachmentsChange: (next: PromptDraftAttachment[]) => void;
}

export interface ComposerAttachmentsController {
  pending: readonly PendingAttachment[];
  isUploading: boolean;
  pickFromLibrary: () => Promise<void>;
  takePhoto: () => Promise<void>;
  pickDocument: () => Promise<void>;
  remove: (path: string) => void;
  /** Local preview URIs by uploaded path (images picked on this device). */
  previewUriByPath: ReadonlyMap<string, string>;
}

let pendingCounter = 0;

function pickedFromImageAsset(
  asset: ImagePicker.ImagePickerAsset,
): PickedAttachmentFile {
  const mimeType =
    asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg");
  return {
    uri: asset.uri,
    name: asset.fileName ?? fallbackAttachmentName(asset.uri, mimeType),
    mimeType,
    sizeBytes: asset.fileSize ?? 0,
  };
}

/**
 * Photo library / camera / document pickers feeding `POST
 * /projects/:id/attachments`. Oversized picks are refused with a toast before
 * any bytes move; each upload shows as a pending chip until the server's
 * `PromptDraftAttachment` lands in the draft.
 */
export function useComposerAttachments({
  projectId,
  attachments,
  onAttachmentsChange,
}: UseComposerAttachmentsArgs): ComposerAttachmentsController {
  const upload = useUploadAttachment(projectId);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [previewUriByPath] = useState(() => new Map<string, string>());
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const onChangeRef = useRef(onAttachmentsChange);
  onChangeRef.current = onAttachmentsChange;

  const uploadFiles = useCallback(
    async (files: PickedAttachmentFile[]) => {
      if (projectId === null) {
        toast.warning("Pick a project before attaching files.");
        return;
      }
      const accepted: PickedAttachmentFile[] = [];
      for (const file of files) {
        const sizeError = validateAttachmentSize(file);
        if (sizeError) {
          toast.error("Attachment too large", { description: sizeError });
          continue;
        }
        accepted.push(file);
      }
      await Promise.all(
        accepted.map(async (file) => {
          const id = `pending-${(pendingCounter += 1)}`;
          const isImage = file.mimeType.startsWith("image/");
          setPending((current) => [
            ...current,
            {
              id,
              name: file.name,
              previewUri: isImage ? file.uri : null,
              progress: 0,
            },
          ]);
          try {
            const uploaded = await upload.mutateAsync({
              file,
              onProgress: (fraction) =>
                setPending((current) =>
                  current.map((entry) =>
                    entry.id === id ? { ...entry, progress: fraction } : entry,
                  ),
                ),
            });
            if (isImage) previewUriByPath.set(uploaded.path, file.uri);
            const existing = attachmentsRef.current;
            if (!existing.some((entry) => entry.path === uploaded.path)) {
              const next = [...existing, uploaded];
              attachmentsRef.current = next;
              onChangeRef.current(next);
            }
          } catch {
            // The profile QueryClient's mutation error toast reported it.
          } finally {
            setPending((current) => current.filter((entry) => entry.id !== id));
          }
        }),
      );
    },
    [previewUriByPath, projectId, upload],
  );

  const pickFromLibrary = useCallback(async () => {
    // The system photo picker runs out of process: no library permission.
    // `Compatible` makes PHPicker hand over JPEG for HEIC/HEIF library
    // assets (the picker otherwise preserves HEIC, which the providers'
    // image inputs do not accept and the runtime would label `image/png`).
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.9,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled) return;
    await uploadFiles(result.assets.map(pickedFromImageAsset));
  }, [uploadFiles]);

  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      toast.warning("Camera access is needed to take a photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (result.canceled) return;
    await uploadFiles(result.assets.map(pickedFromImageAsset));
  }, [uploadFiles]);

  const pickDocument = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    await uploadFiles(
      result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? "",
        sizeBytes: asset.size ?? 0,
      })),
    );
  }, [uploadFiles]);

  const remove = useCallback((path: string) => {
    const next = attachmentsRef.current.filter((entry) => entry.path !== path);
    attachmentsRef.current = next;
    onChangeRef.current(next);
  }, []);

  return {
    pending,
    isUploading: pending.length > 0,
    pickFromLibrary,
    takePhoto,
    pickDocument,
    remove,
    previewUriByPath,
  };
}
