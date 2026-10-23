import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { useThreads } from "@/hooks/queries/thread-queries";
import { ParentThreadPicker } from "./ParentThreadPicker";
import { ProjectSelector } from "./ProjectSelector";

export interface SharedDestinationProject {
  id: string;
  name: string;
}

export function SharedDestinationChooser({
  projectId,
  projects,
  onProjectChange,
  onAddToThread,
  onNewThread,
}: {
  projectId: string | null;
  projects: readonly SharedDestinationProject[];
  onProjectChange: (projectId: string) => void;
  onAddToThread: (threadId: string) => void;
  onNewThread: () => void;
}) {
  const selectedProjectIsAvailable = projects.some(
    (project) => project.id === projectId,
  );
  const threadsQuery = useThreads(
    {
      projectId: selectedProjectIsAvailable
        ? (projectId ?? undefined)
        : undefined,
      archived: false,
    },
    { enabled: selectedProjectIsAvailable },
  );
  const [selection, setSelection] = useState({
    projectId,
    userThreadId: "",
  });
  const orderedThreads = [...(threadsQuery.data ?? [])].sort(
    (left, right) =>
      right.updatedAt - left.updatedAt || right.id.localeCompare(left.id),
  );
  const options = orderedThreads.map((thread) => ({
    label: thread.title ?? thread.titleFallback ?? "Untitled thread",
    value: thread.id,
  }));
  const selectedThreadId =
    selection.projectId === projectId &&
    options.some((option) => option.value === selection.userThreadId)
      ? selection.userThreadId
      : (options[0]?.value ?? "");

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Add shared item to chat</h1>
      <ProjectSelector
        projects={projects}
        value={selectedProjectIsAvailable ? projectId : null}
        allowNoProject
        onChange={(value) => {
          if (value) onProjectChange(value);
        }}
      />
      {projectId && !selectedProjectIsAvailable && (
        <p className="text-sm text-subtle-foreground">
          The remembered project is unavailable. Choose another project to
          continue.
        </p>
      )}
      {selectedProjectIsAvailable && (
        <>
          <ParentThreadPicker
            value={selectedThreadId}
            options={options}
            isLoading={threadsQuery.isLoading || threadsQuery.isFetching}
            isError={threadsQuery.isError}
            onChange={(userThreadId) =>
              setSelection({ projectId, userThreadId })
            }
            onOpenChange={() => {}}
            onRetry={() => void threadsQuery.refetch()}
            triggerLabel="Choose a thread"
            searchLabel="Search project threads"
            mobileTitle="Choose a thread"
          />
          <Button
            type="button"
            disabled={
              !selectedThreadId ||
              threadsQuery.isLoading ||
              threadsQuery.isFetching ||
              threadsQuery.isError ||
              !options.some((option) => option.value === selectedThreadId)
            }
            onClick={() => onAddToThread(selectedThreadId)}
          >
            Add to chat
          </Button>
          <Button type="button" variant="ghost" onClick={onNewThread}>
            Start a new thread instead
          </Button>
        </>
      )}
    </section>
  );
}
