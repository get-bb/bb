import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import type { CrossSurfaceLink, CrossSurfaceLinkKind } from "./schema.js";

const LINK_PRESENTATION: Record<
  CrossSurfaceLinkKind,
  { title: string; icon: IconName }
> = {
  sbom: { title: "SBOM entry", icon: "PackageReceive" },
  firmware: { title: "Files in firmware", icon: "FolderOpen" },
  requirement: { title: "Mitigating requirements", icon: "ListTodo" },
  verification: { title: "Verification runs", icon: "Beaker" },
};

const REASON_COPY = {
  not_pulled: {
    badge: "Not pulled",
    detail: "This surface has no accepted local snapshot yet.",
    action: "Pull surface",
  },
  not_mapped: {
    badge: "Not mapped",
    detail: "No stable mapping resolves this component.",
    action: "Create mapping",
  },
  unavailable: {
    badge: "Unavailable",
    detail: "This surface is not implemented or cannot be reached safely.",
    action: "Check setup",
  },
} as const;

export interface LinkReadinessProps {
  link: CrossSurfaceLink;
  onNavigate(link: CrossSurfaceLink): void;
  onSafeAction(
    kind: CrossSurfaceLinkKind,
    reason: "not_pulled" | "not_mapped" | "unavailable",
  ): void;
}
export function LinkReadiness({
  link,
  onNavigate,
  onSafeAction,
}: LinkReadinessProps): React.JSX.Element {
  const presentation = LINK_PRESENTATION[link.kind];
  const provenance = link.provenance
    ? `${link.provenance.source}${
        link.provenance.at ? ` · ${link.provenance.at}` : ""
      }`
    : null;
  if (link.ready) {
    return (
      <li
        className="rounded-md border border-border bg-background p-2"
        data-link-kind={link.kind}
        data-link-ready="true"
      >
        <Button
          aria-label={`Open ${presentation.title}: ${link.label}`}
          className="h-auto w-full justify-between gap-2 whitespace-normal px-2 py-2 text-left"
          onClick={() => onNavigate(link)}
          size="sm"
          variant="ghost"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon
              aria-hidden="true"
              className="size-4 shrink-0 text-primary"
              name={presentation.icon}
            />
            <span className="min-w-0">
              <span className="block text-xs text-muted-foreground">
                {presentation.title}
              </span>
              <span className="block truncate font-medium">{link.label}</span>
            </span>
          </span>
          <Icon
            aria-hidden="true"
            className="size-4 shrink-0"
            name="ExternalLink"
          />
        </Button>
        {provenance ? (
          <p className="truncate px-2 pb-1 font-mono text-xs text-muted-foreground">
            {provenance}
          </p>
        ) : null}
      </li>
    );
  }

  const reason = link.reason ?? "unavailable";
  const copy = REASON_COPY[reason];
  return (
    <li
      className="rounded-md border border-border bg-muted/30 p-3"
      data-link-kind={link.kind}
      data-link-ready="false"
    >
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          name={presentation.icon}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{presentation.title}</p>
            <Badge variant="outline">{copy.badge}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{copy.detail}</p>
          {provenance ? (
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {provenance}
            </p>
          ) : null}
          <Button
            className="mt-2"
            onClick={() => onSafeAction(link.kind, reason)}
            size="sm"
            variant="outline"
          >
            {copy.action}
          </Button>
        </div>
      </div>
    </li>
  );
}
