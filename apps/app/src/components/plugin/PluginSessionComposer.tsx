import { useEffect, useMemo, useRef, useState } from "react";
import type { PromptTextMention } from "@bb/domain";
import type { ExperimentalSessionComposerProps } from "@get-bb/plugin-sdk";
import { EMPTY_ORDERED_MENTION_SUGGESTIONS } from "@bb/client-core";
import {
  PromptBoxInternal,
  type PromptBoxHandle,
  type TypeaheadConfig,
} from "@/components/promptbox/PromptBoxInternal";
import { usePromptVoice } from "@/components/promptbox/usePromptVoice";
import {
  registerLocalAttachmentPreview,
  releaseLocalAttachmentPreview,
} from "@/lib/attachment-local-previews";

type DraftFile = { path: string; file: File };
const noQuery = () => {};

export function PluginSessionComposer({
  value,
  onChange,
  onSubmit,
  commands = [],
  commandsLoading = false,
  commandsError = false,
  allowAttachments = false,
  disabled = false,
  placeholder = "Message…",
  className,
  attachmentLimits = { count: 10, bytesPerFile: 20 * 1024 * 1024 },
}: ExperimentalSessionComposerProps) {
  const promptBoxRef = useRef<PromptBoxHandle>(null);
  const voice = usePromptVoice(promptBoxRef);
  const [editorValue, setEditorValue] = useState<{
    text: string;
    mentions: PromptTextMention[];
  }>({ text: value, mentions: [] });
  const [files, setFiles] = useState<DraftFile[]>([]);
  const filesRef = useRef(files);
  const [submitting, setSubmitting] = useState(false);
  const sending = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const item of filesRef.current)
        releaseLocalAttachmentPreview(item.path);
    };
  }, []);
  function replaceFiles(next: DraftFile[]) {
    filesRef.current = next;
    setFiles(next);
  }
  function removeFile(path: string) {
    releaseLocalAttachmentPreview(path);
    replaceFiles(filesRef.current.filter((item) => item.path !== path));
  }
  function attach(newFiles: File[]) {
    if (disabled || sending.current) return;
    if (filesRef.current.length + newFiles.length > attachmentLimits.count) {
      setError(`Attach up to ${attachmentLimits.count} files.`);
      return;
    }
    if (newFiles.some((file) => file.size > attachmentLimits.bytesPerFile)) {
      setError(
        `Each file must be at most ${Math.floor(attachmentLimits.bytesPerFile / 1024 / 1024)} MiB.`,
      );
      return;
    }
    const additions = newFiles.map((file) => {
      const path = `session-attachment:${crypto.randomUUID()}`;
      registerLocalAttachmentPreview(path, file);
      return { path, file };
    });
    replaceFiles([...filesRef.current, ...additions]);
    setError(null);
  }
  async function submit() {
    if (
      disabled ||
      sending.current ||
      (!value.trim() && filesRef.current.length === 0)
    )
      return;
    sending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        text: value,
        files: filesRef.current.map((item) => item.file),
      });
      if (!mounted.current) return;
      for (const item of filesRef.current)
        releaseLocalAttachmentPreview(item.path);
      replaceFiles([]);
      onChange("");
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      sending.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }
  const typeahead = useMemo<TypeaheadConfig>(
    () => ({
      mention: {
        triggers: [],
        results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
        isLoading: false,
        isError: false,
        onQueryChange: noQuery,
      },
      command: {
        trigger: "/",
        suggestions: commands
          .filter(
            (command) =>
              !query ||
              `${command.name} ${command.description ?? ""}`
                .toLowerCase()
                .includes(query.toLowerCase()),
          )
          .map((command) => ({
            kind: "command",
            name: command.name,
            source: "skill",
            origin: "user",
            description: command.description ?? null,
            argumentHint: command.argumentHint ?? null,
          })),
        isLoading: commandsLoading,
        isError: commandsError,
        hasMore: false,
        isLoadingMore: false,
        loadMore: noQuery,
        onQueryChange: setQuery,
      },
    }),
    [commands, commandsLoading, commandsError, query],
  );
  return (
    <div className={className} data-session-composer="">
      {error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <PromptBoxInternal
        promptBoxRef={promptBoxRef}
        value={value}
        mentionRanges={editorValue.text === value ? editorValue.mentions : []}
        onChange={(text, mentions) => {
          setEditorValue({ text, mentions });
          onChange(text);
        }}
        onSubmit={() => void submit()}
        placeholder={placeholder}
        submission={{
          isSubmitting: submitting,
          disabled: disabled || submitting,
          title: "Send",
          hideEmpty: true,
        }}
        typeahead={typeahead}
        mentionMenuPlacement="top"
        promptActions={[{ kind: "skills", text: "/" }]}
        suppressPluginComposerCustomizations
        voice={voice}
        attachments={{
          items: files.map(({ path, file }) => ({
            path,
            type: file.type.startsWith("image/") ? "localImage" : "localFile",
            name: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          })),
          onAttachFiles: allowAttachments ? attach : undefined,
          onRemove: disabled || submitting ? undefined : removeFile,
        }}
      />
    </div>
  );
}
