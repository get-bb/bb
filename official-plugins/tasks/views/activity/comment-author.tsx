import type { DisplayComment } from "../../shared/contract.js";
import { commentByline } from "./time.js";

/**
 * Comment byline. Agent comments whose thread is still resolvable render the
 * thread's human title as a link that opens the chat; everything else (users,
 * legacy agent comments with no thread, deleted/hidden/side-chat threads)
 * falls back to the stored author name so the byline is never blank and no
 * unresolved thread is exposed.
 *
 * Kept SDK-free (navigation is injected via `onOpenThread`) so it renders in a
 * plain jsdom test without the plugin app runtime.
 */
export function CommentAuthor({
  comment,
  onOpenThread,
}: {
  comment: DisplayComment;
  onOpenThread: (threadId: string) => void;
}) {
  const byline = commentByline(comment);
  if (byline.kind === "thread-link") {
    return (
      <button
        type="button"
        onClick={() => onOpenThread(byline.threadId)}
        className="truncate font-semibold text-primary hover:underline"
        title={byline.title}
      >
        {byline.title}
      </button>
    );
  }
  return <span className="font-semibold">{byline.name}</span>;
}
