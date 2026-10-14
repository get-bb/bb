import type { OAuthGrantView } from "@/server/oauth";

const CONNECTED_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function grantConnectedLabel(createdAt: number): string {
  return `Connected ${CONNECTED_DATE_FORMAT.format(new Date(createdAt))}`;
}

export function grantLastUsedLabel(
  lastUsedAt: number | null,
  relativeTime: (ms: number) => string,
): string {
  return lastUsedAt === null
    ? "Never used"
    : `Last used ${relativeTime(lastUsedAt)}`;
}

export function ConnectedApps({
  grants,
  revokingId,
  relativeTime,
  onRevoke,
}: {
  grants: OAuthGrantView[];
  revokingId: string | null;
  relativeTime: (ms: number) => string;
  onRevoke: (grant: OAuthGrantView) => void;
}) {
  if (grants.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-border bg-card p-2 shadow-sm">
      <div className="flex items-center px-3 pb-1.5 pt-1.5">
        <h3 className="flex-1 text-base font-semibold tracking-tight">
          Connected apps
        </h3>
      </div>
      {grants.map((grant) => (
        <div
          key={grant.id}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-tight">
              {grant.clientName}
              <span className="font-normal text-muted-foreground">
                {" · "}
                <span className="font-mono">{grant.serverHandle}</span>
              </span>
            </span>
            <span
              className="mt-px block truncate text-xs text-muted-foreground"
              suppressHydrationWarning
            >
              {grantConnectedLabel(grant.createdAt)}
              {" · "}
              {grantLastUsedLabel(grant.lastUsedAt, relativeTime)}
            </span>
          </span>
          <button
            className="text-xs text-destructive-text hover:underline disabled:opacity-50"
            disabled={revokingId === grant.id}
            onClick={() => onRevoke(grant)}
          >
            {revokingId === grant.id ? "Revoking…" : "Revoke"}
          </button>
        </div>
      ))}
    </div>
  );
}
