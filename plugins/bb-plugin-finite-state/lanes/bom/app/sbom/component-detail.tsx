import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { useBbNavigate, useRpc } from "@bb/plugin-sdk/app";
import type { rpcContract } from "../../../../shared/contract.js";
import { focusSubPath } from "../../../product-security/canvas/nodes/selection.js";
import { useBomScope, useComponentData } from "./component-card.js";
import { encodeComponentRouteKey } from "./routes.js";

function normalizedFirmwarePath(path: string): string | null {
  const normalized = path.replace(/^\/+/, "");
  return normalized.length > 0 &&
    normalized.length <= 1024 &&
    !normalized.includes("\\") &&
    !normalized.split("/").includes("..")
    ? normalized
    : null;
}

function DetailSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4 p-5" aria-label="Loading component detail">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export interface ComponentDetailProps {
  id: string;
  onClose(): void;
}

export function ComponentDetail({
  id,
  onClose,
}: ComponentDetailProps): React.JSX.Element {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const bomScope = useBomScope();
  const componentState = useComponentData(id);
  const [mountState, setMountState] = useState<
    "loading" | "mounted" | "missing" | "error"
  >("loading");
  const [materializing, setMaterializing] = useState<string | null>(null);
  const [materializeError, setMaterializeError] = useState<string | null>(null);
  const component = componentState.data;
  const scope = component?.cache;

  const loadMounts = useCallback(async () => {
    if (!component || !bomScope) return;
    try {
      const result = await rpc.call("firmwareMountsList", {
        projectId: bomScope.projectId,
        projectVersionId: bomScope.projectVersionId,
        pageSize: 1,
        continuation: null,
      });
      setMountState(result.items.length > 0 ? "mounted" : "missing");
    } catch {
      setMountState("error");
    }
  }, [bomScope, component, rpc]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadMounts(), 0);
    return () => window.clearTimeout(task);
  }, [loadMounts]);

  const projectScope = useMemo(
    () =>
      bomScope
        ? {
            projectId: bomScope.projectId,
            projectVersionId: bomScope.projectVersionId,
          }
        : null,
    [bomScope],
  );

  if (componentState.status === "loading") return <DetailSkeleton />;
  if (
    !component ||
    componentState.status === "error" ||
    componentState.status === "empty" ||
    componentState.status === "invalid"
  ) {
    return (
      <div className="p-5">
        <div className="rounded-lg border border-destructive/40 bg-card p-5 text-sm">
          <h2 className="font-semibold">Component detail unavailable</h2>
          <p className="mt-1 text-muted-foreground">
            {componentState.error ??
              "The component no longer exists in this cache."}
          </p>
          <div className="mt-4 flex gap-2">
            <Button onClick={componentState.retry} variant="outline">
              Retry
            </Button>
            <Button onClick={onClose} variant="ghost">
              Close
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const openLink = (kind: string, key: string) => {
    if (kind === "hbomPart") {
      navigate.toPluginPanel("bom", {
        subPath: `hardware/${encodeURIComponent(key)}`,
      });
      return;
    }
    if (kind === "requirement") {
      navigate.toPluginPanel("product-security", { subPath: "requirements" });
      return;
    }
    navigate.toPluginPanel("product-security", {
      subPath: focusSubPath("node", key),
    });
  };

  return (
    <aside
      className="h-full overflow-auto border-l border-border bg-card text-foreground"
      aria-label="Component detail"
    >
      {scope?.state === "stale" ? (
        <div
          className="border-b border-destructive/40 bg-muted px-4 py-2 text-xs"
          role="status"
        >
          Stale cache ·{" "}
          {scope.message ?? "showing the last complete component record"}
        </div>
      ) : null}
      <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Software component
          </p>
          <h2 className="mt-1 truncate text-lg font-semibold">
            {component.label}
          </h2>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {component.purl ?? "No purl · fallback identity"}
          </p>
        </div>
        <Button
          aria-label="Close component detail"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <Icon aria-hidden="true" className="size-4" name="CircleX" />
        </Button>
      </header>
      <div className="space-y-5 p-5">
        <section aria-labelledby="component-identity">
          <h3 className="text-sm font-semibold" id="component-identity">
            Identity
          </h3>
          <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 rounded-lg border border-border bg-background p-3 text-xs">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="col-span-2 font-mono">
              {component.version ?? "Unknown"}
            </dd>
            <dt className="text-muted-foreground">License</dt>
            <dd className="col-span-2 font-mono">
              {component.license ?? "Unknown"}
            </dd>
            <dt className="text-muted-foreground">Supplier</dt>
            <dd className="col-span-2">{component.supplier ?? "Unknown"}</dd>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="col-span-2">{component.source ?? "Unreported"}</dd>
            <dt className="text-muted-foreground">CPE</dt>
            <dd className="col-span-2 break-all font-mono">
              {component.cpe ?? "Not reported"}
            </dd>
          </dl>
        </section>

        <section aria-labelledby="component-vulnerabilities">
          <div className="flex items-center justify-between">
            <h3
              className="text-sm font-semibold"
              id="component-vulnerabilities"
            >
              Vulnerabilities
            </h3>
            <Badge
              variant={
                component.findings.length > 0 ? "destructive" : "secondary"
              }
            >
              {component.findings.length}
            </Badge>
          </div>
          {component.findings.length === 0 ? (
            <div className="mt-2 rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
              No joined CVEs in the accepted findings cache.
            </div>
          ) : (
            <div className="mt-2 space-y-1">
              {component.findings.map((finding) => (
                <button
                  className="grid w-full grid-cols-2 gap-2 rounded-lg border border-border bg-background p-3 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  key={finding.stableKey}
                  onClick={() =>
                    navigate.toPluginPanel("findings", {
                      subPath: `f/${encodeComponentRouteKey(finding.stableKey)}`,
                    })
                  }
                  type="button"
                >
                  <span className="font-mono font-semibold">
                    {finding.cve ?? finding.stableKey}
                  </span>
                  <span className="text-right capitalize text-muted-foreground">
                    {finding.severity ?? "Unknown"}
                  </span>
                  <span className="text-muted-foreground">
                    EPSS {finding.epss === null ? "—" : finding.epss.toFixed(3)}{" "}
                    · {finding.kev ? "KEV" : "not KEV"}
                  </span>
                  <span className="text-right text-muted-foreground">
                    {finding.reachability ?? "unknown"} ·{" "}
                    {finding.vexStatus ?? "no VEX"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="component-files">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold" id="component-files">
                Files in image
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Finding-location evidence · not authoritative SCA component
                mapping
              </p>
            </div>
            {mountState === "error" ? (
              <Button
                onClick={() => void loadMounts()}
                size="sm"
                variant="outline"
              >
                Retry mount check
              </Button>
            ) : null}
          </div>
          {component.files.length === 0 ? (
            <p className="mt-2 rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
              No cached finding-location paths.
            </p>
          ) : (
            <div className="mt-2 space-y-1">
              {component.files.map((path) => {
                const rpcPath = normalizedFirmwarePath(path);
                return (
                  <div
                    className="rounded-lg border border-border bg-background p-3"
                    key={path}
                  >
                    <code className="block break-all text-xs text-foreground">
                      {path}
                    </code>
                    <div className="mt-2 flex items-center gap-2">
                      {mountState === "mounted" ? (
                        <Button
                          onClick={() =>
                            navigate.toPluginPanel("firmware", {
                              subPath: `tree/${encodeURIComponent(path)}`,
                            })
                          }
                          size="sm"
                          variant="outline"
                        >
                          Reveal in firmware tree
                        </Button>
                      ) : (
                        <Button
                          disabled={
                            !rpcPath || !projectScope || materializing === path
                          }
                          onClick={() => {
                            if (!rpcPath || !projectScope) return;
                            setMaterializing(path);
                            setMaterializeError(null);
                            void rpc
                              .call("firmwareMaterializeStart", {
                                ...projectScope,
                                source: "api",
                                mode: "files",
                                firmwarePaths: [rpcPath],
                              })
                              .then(() => setMountState("mounted"))
                              .catch((cause: unknown) => {
                                setMaterializeError(
                                  cause instanceof Error
                                    ? cause.message
                                    : "Materialization failed.",
                                );
                              })
                              .finally(() => setMaterializing(null));
                          }}
                          size="sm"
                          variant="outline"
                        >
                          Materialize firmware
                        </Button>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {mountState === "loading"
                          ? "Checking local mount…"
                          : mountState === "missing"
                            ? "No local mount"
                            : null}
                      </span>
                    </div>
                    {materializeError ? (
                      <p className="mt-2 text-xs text-destructive">
                        {materializeError}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="component-references">
          <h3 className="text-sm font-semibold" id="component-references">
            Referenced by
          </h3>
          {component.links.filter((link) => link.kind !== "hbomPart").length ===
          0 ? (
            <p className="mt-2 rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
              No architecture, threat, or requirement links.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {component.links
                .filter((link) => link.kind !== "hbomPart")
                .map((link) => (
                  <Button
                    key={`${link.kind}:${link.key}`}
                    onClick={() => openLink(link.kind, link.key)}
                    size="sm"
                    variant="outline"
                  >
                    {link.kind} · {link.label}
                  </Button>
                ))}
            </div>
          )}
        </section>

        <section aria-labelledby="component-hbom">
          <h3 className="text-sm font-semibold" id="component-hbom">
            Linked HBOM part
          </h3>
          {component.links
            .filter((link) => link.kind === "hbomPart")
            .map((link) => (
              <Button
                className="mt-2"
                key={link.key}
                onClick={() => openLink(link.kind, link.key)}
                variant="outline"
              >
                {link.label}
              </Button>
            ))}
          {component.links.every((link) => link.kind !== "hbomPart") ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No hardware part link.
            </p>
          ) : null}
        </section>
      </div>
    </aside>
  );
}
