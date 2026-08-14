import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { useBbContext, useBbNavigate, useRpc } from "@bb/plugin-sdk/app";
import type { z } from "zod";
import {
  canvasLinksRpcContract,
  type CrossSurfaceLink,
} from "../../../product-security/canvas/links/schema.js";
import {
  navigateFindingLink,
  navigateFindingLinkRecovery,
  type FindingCrossLink,
} from "./links.js";
import type { FindingDetailRow } from "./useFindingDetail.js";

type FamilyResult = z.output<
  (typeof canvasLinksRpcContract)["canvasSbomLinks"]["output"]
>;
type FamilyMethod =
  | "canvasSbomLinks"
  | "canvasFirmwareLinks"
  | "canvasRequirementLinks"
  | "canvasVerificationLinks";

const ICONS: Record<FindingCrossLink["kind"], IconName> = {
  firmware: "FolderOpen",
  sbom: "PackageReceive",
  tara: "Workflow",
  requirement: "ListTodo",
  verification: "Beaker",
};

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message.slice(0, 240)
    : "Linked surface unavailable.";
}

function unready(
  kind: FindingCrossLink["kind"],
  reason: string,
  action: "pull" | "inspect" = "pull",
): FindingCrossLink {
  return {
    kind,
    target: "",
    label:
      kind === "tara"
        ? "TARA component"
        : kind === "sbom"
          ? "SBOM component"
          : kind === "firmware"
            ? "Firmware location"
            : kind === "requirement"
              ? "Related requirements"
              : "Verification results",
    ready: false,
    reason,
    action,
  };
}

function mapFamily(
  kind: "sbom" | "firmware" | "requirement" | "verification",
  result: FamilyResult,
): FindingCrossLink[] {
  if (kind === "verification") {
    return [
      unready(
        "verification",
        "Verification links are unavailable until WP-39 ships the public resolver.",
        "inspect",
      ),
    ];
  }
  const links = result.links
    .filter((link) => link.kind === kind)
    .map(
      (link: CrossSurfaceLink): FindingCrossLink => ({
        kind,
        target: link.target,
        label: link.label,
        ready: link.ready,
        ...(link.reason
          ? {
              reason:
                result.readiness.message ?? link.reason.replaceAll("_", " "),
              action: link.reason === "not_pulled" ? "pull" : "inspect",
            }
          : {}),
      }),
    );
  return links.length > 0
    ? links
    : [unready(kind, result.readiness.message ?? "No mapping is available.")];
}

export function CrossLinks({
  rows,
}: {
  rows: readonly FindingDetailRow[];
}): React.JSX.Element {
  const rpc = useRpc<typeof canvasLinksRpcContract>();
  const navigate = useBbNavigate();
  const { projectId: workspaceProjectId } = useBbContext();
  const primary = rows[0];
  const sourceSlug =
    rows
      .map((row) => row.componentSlug)
      .find((value): value is string => Boolean(value)) ?? null;
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(Boolean(primary && sourceSlug));
  const [links, setLinks] = useState<FindingCrossLink[]>([]);
  const fallbackLinks = useMemo(
    () => [
      unready(
        "firmware",
        "No public component mapping is cached for this finding.",
      ),
      unready(
        "sbom",
        "No public component mapping is cached for this finding.",
      ),
      unready(
        "tara",
        "No TARA component slug is cached for this finding.",
        "inspect",
      ),
      unready(
        "requirement",
        "Requirements need a mapped TARA component.",
        "inspect",
      ),
      unready(
        "verification",
        "Verification links are unavailable until WP-39 ships the public resolver.",
        "inspect",
      ),
    ],
    [],
  );

  useEffect(() => {
    if (!primary || !sourceSlug || !workspaceProjectId) return;
    let active = true;
    setLoading(true);
    const input = {
      workspaceProjectId,
      platformProjectId: primary.projectId,
      projectVersionId: primary.projectVersionId,
      sourceSlug,
    };
    const calls: Array<[FamilyMethod, FindingCrossLink["kind"]]> = [
      ["canvasFirmwareLinks", "firmware"],
      ["canvasSbomLinks", "sbom"],
      ["canvasRequirementLinks", "requirement"],
      ["canvasVerificationLinks", "verification"],
    ];
    void Promise.allSettled(
      calls.map(([method]) => rpc.call(method, input)),
    ).then((results) => {
      if (!active) return;
      const resolved = results.flatMap((result, index) => {
        const kind = calls[index]?.[1];
        if (!kind || kind === "tara") return [];
        return result.status === "fulfilled"
          ? mapFamily(kind, result.value)
          : [unready(kind, safeMessage(result.reason), "inspect")];
      });
      // WP-34 has no public TARA readiness family. A source slug identifies a
      // possible node target, but it does not prove the downstream model or
      // node exists, so keep this affordance disabled until a real signal ships.
      resolved.splice(
        2,
        0,
        unready(
          "tara",
          "TARA readiness is unavailable because no public node resolver has shipped.",
          "inspect",
        ),
      );
      setLinks(resolved);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [primary, revision, rpc, sourceSlug, workspaceProjectId]);

  const grouped = sourceSlug ? links : fallbackLinks;
  const open = useCallback(
    (link: FindingCrossLink) => navigateFindingLink(navigate, link),
    [navigate],
  );
  const recover = useCallback(
    (link: FindingCrossLink) => navigateFindingLinkRecovery(navigate, link),
    [navigate],
  );

  return (
    <section aria-labelledby="finding-cross-links" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon
            aria-hidden="true"
            className="size-4 text-primary"
            name="ExternalLink"
          />
          <h3 className="text-sm font-semibold" id="finding-cross-links">
            Connected surfaces
          </h3>
        </div>
        <Button
          onClick={() => setRevision((current) => current + 1)}
          size="sm"
          variant="ghost"
        >
          <Icon aria-hidden="true" className="size-4" name="RotateCcw" />
          Retry links
        </Button>
      </div>
      {loading && sourceSlug ? (
        <div aria-label="Loading finding cross-links" className="space-y-2">
          {[0, 1, 2, 3].map((row) => (
            <div
              className="h-14 animate-pulse rounded-lg border border-border bg-muted"
              key={row}
            />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {grouped.map((link, index) => (
            <li
              className="flex items-center gap-3 rounded-lg border border-border bg-background p-3 text-xs"
              key={`${link.kind}:${link.target}:${index}`}
            >
              <Icon
                aria-hidden="true"
                className={`size-4 shrink-0 ${link.ready ? "text-primary" : "text-muted-foreground"}`}
                name={ICONS[link.kind]}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{link.label}</p>
                  <Badge variant={link.ready ? "secondary" : "outline"}>
                    {link.ready ? "Ready" : "Unavailable"}
                  </Badge>
                </div>
                {link.reason ? (
                  <p className="mt-1 break-words text-muted-foreground">
                    {link.reason}
                  </p>
                ) : null}
              </div>
              {link.ready ? (
                <Button onClick={() => open(link)} size="sm" variant="outline">
                  Open
                </Button>
              ) : link.kind === "verification" || link.kind === "tara" ? (
                <Button disabled size="sm" variant="ghost">
                  Unavailable
                </Button>
              ) : (
                <Button onClick={() => recover(link)} size="sm" variant="ghost">
                  {link.action === "pull" ? "Pull" : "Inspect"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
