const SHORT_SHA_LENGTH = 7;

export function CommitToastDescription({
  commitSha,
  commitSubject,
}: {
  commitSha: string;
  commitSubject: string;
}) {
  const shortSha = commitSha.slice(0, SHORT_SHA_LENGTH);
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap leading-5"
      title={`${shortSha} · ${commitSubject}`}
    >
      <span className="shrink-0 whitespace-pre font-mono text-foreground">
        {shortSha}
      </span>
      <span className="shrink-0 whitespace-pre text-muted-foreground">·</span>
      <span className="min-w-0 truncate whitespace-pre text-muted-foreground">
        {commitSubject}
      </span>
    </span>
  );
}
