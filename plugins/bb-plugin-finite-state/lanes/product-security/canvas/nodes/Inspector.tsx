import { useState } from "react";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import type {
  ArchitectureEdgeData,
  ArchitectureNodeData,
  UnresolvedRef,
} from "./adapters.js";
import { useArchitectureSelection } from "./selection.js";

const PAGE_SIZE = 16;

function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="border-t border-border px-4 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="mt-2 text-sm">{children}</div>
    </section>
  );
}

function PagedListPage({
  label,
  values,
}: {
  label: string;
  values: readonly string[];
}): React.JSX.Element {
  const [page, setPage] = useState(0);
  const start = page * PAGE_SIZE;
  const visible = values.slice(start, start + PAGE_SIZE);
  if (values.length === 0) return <p className="text-muted-foreground">None</p>;
  return (
    <div>
      <ul aria-label={label} className="space-y-1" data-inspector-list={label}>
        {visible.map((value) => (
          <li className="truncate rounded-md bg-muted px-2 py-1" key={value}>
            {value}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        {page > 0 ? (
          <Button
            className="flex-1"
            onClick={() => setPage((current) => current - 1)}
            size="sm"
            variant="outline"
          >
            Previous page
          </Button>
        ) : null}
        {start + PAGE_SIZE < values.length ? (
          <Button
            className="flex-1"
            onClick={() => setPage((current) => current + 1)}
            size="sm"
            variant="outline"
          >
            Next page ({Math.min(PAGE_SIZE, values.length - start - PAGE_SIZE)})
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PagedList({
  label,
  values,
  revision,
}: {
  label: string;
  values: readonly string[];
  revision: string;
}): React.JSX.Element {
  return <PagedListPage key={revision} label={label} values={values} />;
}

function SourceFileActions({
  sourceFile,
  slug,
}: {
  sourceFile: string;
  slug: string;
}): React.JSX.Element {
  const selection = useArchitectureSelection();
  const [copied, setCopied] = useState(false);
  const copySourcePath = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(sourceFile);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="min-w-0" data-source-file={sourceFile}>
      <p className="truncate font-mono text-xs text-muted-foreground">
        {sourceFile}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          onClick={() => selection.onRepairSourceFile(sourceFile, slug)}
          size="sm"
          variant="outline"
        >
          <Icon aria-hidden="true" className="size-4" name="BubbleChatQuestion" />
          Repair via chat
        </Button>
        <Button
          aria-label={`Copy source path ${sourceFile}`}
          onClick={() => void copySourcePath()}
          size="sm"
          variant="outline"
        >
          <Icon aria-hidden="true" className="size-4" name="Copy" />
          {copied ? "Copied" : "Copy path"}
        </Button>
      </div>
    </div>
  );
}

function UnresolvedList({
  refs,
}: {
  refs: readonly UnresolvedRef[];
}): React.JSX.Element | null {
  if (refs.length === 0) return null;
  return (
    <InspectorSection title="Unresolved references">
      <div className="space-y-2" role="alert">
        {refs.slice(0, PAGE_SIZE).map((ref) => (
          <div
            className="rounded-md border border-destructive/40 p-2"
            key={`${ref.field}:${ref.targetSlug}`}
          >
            <Badge variant="destructive">Unresolved {ref.field}</Badge>
            <p className="mt-1 text-muted-foreground">{ref.message}</p>
            <div className="mt-2">
              <SourceFileActions
                slug={ref.ownerSlug}
                sourceFile={ref.sourceFile}
              />
            </div>
          </div>
        ))}
      </div>
    </InspectorSection>
  );
}

function NodeInspector({
  node,
}: {
  node: ArchitectureNodeData;
}): React.JSX.Element {
  const selection = useArchitectureSelection();
  const adjacency = selection.adjacency.get(node.slug);
  const connectedFlows = adjacency?.connectedFlowSlugs ?? [];
  const interfaces = (node.interfaces ?? []).map((entry) =>
    [entry.name, entry.protocol, entry.port, entry.direction]
      .filter((value) => value !== undefined)
      .join(" · "),
  );
  const refs = selection.unresolved.filter(
    (ref) => ref.ownerSlug === node.slug,
  );
  return (
    <>
      <InspectorSection title="Identity">
        <p className="font-medium">{node.name}</p>
        <p className="font-mono text-xs text-muted-foreground">
          Slug: {node.slug}
        </p>
        <Badge className="mt-2" variant="secondary">
          {node.kind}
        </Badge>
        {node.componentType ? (
          <Badge className="ml-1" variant="outline">
            {node.componentType}
          </Badge>
        ) : null}
      </InspectorSection>
      <InspectorSection title="Description">
        <p className="text-muted-foreground">
          {node.description ?? "No description authored."}
        </p>
      </InspectorSection>
      <InspectorSection title="Criticality">
        <p>{node.criticality ?? "Not specified"}</p>
      </InspectorSection>
      <InspectorSection title="Interfaces & technologies">
        <PagedList
          label="Interfaces"
          revision={node.slug}
          values={interfaces}
        />
        {node.technologies?.length ? (
          <div className="mt-3">
            <PagedList
              label="Technologies"
              revision={node.slug}
              values={node.technologies}
            />
          </div>
        ) : null}
      </InspectorSection>
      <InspectorSection title="Zone">
        <p>
          {node.zone ??
            (node.kind === "zone" ? "Top-level zone" : "Unassigned")}
        </p>
      </InspectorSection>
      <InspectorSection title="Connected flows">
        <PagedList
          label="Connected flows"
          revision={node.slug}
          values={connectedFlows}
        />
      </InspectorSection>
      <InspectorSection title="Affected assets & threats">
        <p className="mb-2">Threats: {node.threatCount ?? 0}</p>
        <PagedList
          label="Affected assets"
          revision={node.slug}
          values={node.affectedAssets ?? []}
        />
      </InspectorSection>
      <UnresolvedList refs={refs} />
      <InspectorSection title="Source file">
        <SourceFileActions slug={node.slug} sourceFile={node.sourceFile} />
      </InspectorSection>
    </>
  );
}

function EdgeInspector({
  edge,
}: {
  edge: ArchitectureEdgeData;
}): React.JSX.Element {
  const selection = useArchitectureSelection();
  const refs = selection.unresolved.filter(
    (ref) => ref.ownerSlug === edge.slug,
  );
  return (
    <>
      <InspectorSection title="Identity">
        <p className="font-medium">{edge.name ?? edge.slug}</p>
        <p className="font-mono text-xs text-muted-foreground">
          Slug: {edge.slug}
        </p>
        <Badge className="mt-2" variant="secondary">
          dataflow
        </Badge>
      </InspectorSection>
      <InspectorSection title="Description">
        <p className="text-muted-foreground">
          {edge.description ?? "No description authored."}
        </p>
      </InspectorSection>
      <InspectorSection title="Direction">
        <p className="flex items-center gap-1">
          <span>{edge.sourceSlug}</span>
          <Icon
            aria-hidden="true"
            className="size-4"
            name={edge.bidirectional ? "ArrowUpDown" : "ArrowRight"}
          />
          <span>{edge.targetSlug}</span>
        </p>
        <p className="mt-1 text-muted-foreground">
          {edge.bidirectional ? "Bidirectional" : "One way"}
        </p>
      </InspectorSection>
      <InspectorSection title="Protocol & controls">
        <p>Protocol: {edge.protocol ?? "Not specified"}</p>
        <p>Encryption: {edge.encrypted ? "Encrypted" : "Unencrypted"}</p>
        <p>
          Authentication:{" "}
          {edge.authenticated ? "Authenticated" : "Unauthenticated"}
        </p>
      </InspectorSection>
      <UnresolvedList refs={refs} />
      <InspectorSection title="Source file">
        <SourceFileActions slug={edge.slug} sourceFile={edge.sourceFile} />
      </InspectorSection>
    </>
  );
}

export function Inspector(): React.JSX.Element {
  const selection = useArchitectureSelection();
  const ids =
    selection.selectedIds.length > 0
      ? selection.selectedIds
      : selection.focusId
        ? [selection.focusId]
        : [];
  const selectedId = ids.length === 1 ? ids[0] : undefined;
  const node = selectedId ? selection.nodesBySlug.get(selectedId) : undefined;
  const edge = selectedId ? selection.edgesBySlug.get(selectedId) : undefined;
  const unresolved = selectedId
    ? selection.unresolved.filter((ref) => ref.ownerSlug === selectedId)
    : [];
  return (
    <aside
      aria-label="Architecture inspector"
      className="h-full min-h-0 w-80 shrink-0 overflow-y-auto border-l border-border bg-card text-card-foreground"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Inspector</h2>
          <p className="text-xs text-muted-foreground">{ids.length} selected</p>
        </div>
        <Button
          disabled={ids.length === 0}
          onClick={selection.fitSelection}
          size="sm"
          variant="outline"
        >
          <Icon aria-hidden="true" name="Maximize2" />
          Fit
        </Button>
      </header>
      {ids.length === 0 ? (
        <div className="p-5 text-sm text-muted-foreground">
          Select a component, zone, asset, or dataflow to inspect it.
        </div>
      ) : ids.length > 1 ? (
        <InspectorSection title="Multiple selection">
          <PagedList
            label="Selected architecture entities"
            revision={ids.join("|")}
            values={ids}
          />
        </InspectorSection>
      ) : node ? (
        <NodeInspector node={node} />
      ) : edge ? (
        <EdgeInspector edge={edge} />
      ) : unresolved.length > 0 ? (
        <UnresolvedList refs={unresolved} />
      ) : (
        <div className="p-5 text-sm text-muted-foreground">
          The focused slug is not present in this model revision.
        </div>
      )}
    </aside>
  );
}
