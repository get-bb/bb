import { useCallback, useEffect, useMemo, useState } from "react";
import { useRpc, type PluginFileOpenerProps } from "@bb/plugin-sdk/app";
import { Alert, AlertDescription, AlertTitle } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@bb/shared-ui/card";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { rpcContract } from "../../../shared/contract.js";

interface FileIdentity {
  pvId: string;
  firmwarePath: string;
}

interface BinaryMetadata {
  firmwarePath: string;
  fileSha256: string;
  size: number | null;
  mediaType: string | null;
  fields: Record<string, unknown>;
  previewHex: string | null;
  previewBytes: number;
  materialized: boolean;
}

const binaryExtensions = new Set(["bin", "elf", "fw", "img", "ko", "o", "out", "rom", "so"]);

export function isFirmwareBinaryMetadata(
  mediaType: string | null,
  fullType: string | null,
  path: string,
): boolean {
  const normalized = `${mediaType ?? ""} ${fullType ?? ""}`.toLowerCase();
  if (/\belf\b|executable|shared object|kernel module|application\/octet-stream/u.test(normalized)) return true;
  const name = path.split("/").at(-1) ?? path;
  const extension = name.includes(".") ? name.split(".").at(-1)?.toLowerCase() ?? "" : "";
  return binaryExtensions.has(extension) && normalized.length > 0;
}

function identityFromPath(path: string): FileIdentity | null {
  const segments = path.replaceAll("\\", "/").split("/").filter(Boolean);
  const cache = segments.lastIndexOf(".fs-firmware");
  if (cache < 0 || segments[cache + 2] !== "rootfs" || !segments[cache + 1] || !segments[cache + 3]) return null;
  return {
    pvId: segments[cache + 1]!,
    firmwarePath: segments.slice(cache + 3).join("/"),
  };
}

function stringField(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" ? value : null;
}

function nullableField(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "Unknown";
}

function formatHex(hex: string): string[] {
  const bytes = hex.match(/.{1,2}/gu) ?? [];
  const rows: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.slice(offset, offset + 16);
    rows.push(`${offset.toString(16).padStart(4, "0")}  ${chunk.join(" ")}`);
  }
  return rows;
}

export function BinaryOpener({ path, source }: PluginFileOpenerProps): React.JSX.Element {
  const rpc = useRpc<typeof rpcContract>();
  const identity = useMemo(() => identityFromPath(path), [path]);
  const [metadata, setMetadata] = useState<BinaryMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminDenied, setAdminDenied] = useState(false);

  const load = useCallback(async () => {
    if (!identity || !source.projectId) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const result = await rpc.call("firmwareFileGet", {
        projectId: source.projectId,
        projectVersionId: identity.pvId,
        firmwarePath: identity.firmwarePath,
        includePreview: true,
      });
      setMetadata(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Binary metadata is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [identity, rpc, source.projectId]);

  useEffect(() => { void load(); }, [load]);

  async function hydrate(): Promise<void> {
    if (!identity || !source.projectId || hydrating) return;
    setHydrating(true);
    setError(null);
    setAdminDenied(false);
    try {
      await rpc.call("firmwareFileHydrate", {
        projectId: source.projectId,
        projectVersionId: identity.pvId,
        firmwarePath: identity.firmwarePath,
      });
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Firmware bytes could not be hydrated.";
      setAdminDenied(/403|VIEW_ANY_PROJECT_FILE|org-admin|administrator/iu.test(message));
      setError(message);
    } finally {
      setHydrating(false);
    }
  }

  if (loading) {
    return <div className="space-y-3 p-4" aria-label="Loading binary metadata"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /><Skeleton className="h-56 w-full" /></div>;
  }
  if (!identity || !source.projectId) {
    return (
      <div className="p-4">
        <Alert><Icon name="FileQuestion" className="size-4" /><AlertTitle>Not a mounted firmware file</AlertTitle><AlertDescription>This opener only reads verified manifest identities. Use the built-in preview for other files; raw binary is never rendered as text.</AlertDescription></Alert>
      </div>
    );
  }
  if (!metadata) {
    return (
      <div className="space-y-3 p-4">
        <Alert variant="destructive"><Icon name="AlertCircle" className="size-4" /><AlertTitle>Binary metadata unavailable</AlertTitle><AlertDescription>{error ?? "The manifest does not contain this file."}</AlertDescription></Alert>
        <Button variant="outline" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  const fullType = stringField(metadata.fields, "fullType");
  const binary = isFirmwareBinaryMetadata(metadata.mediaType, fullType, metadata.firmwarePath);
  const features = metadata.fields.securityFeatures;
  const securityFeatures = features !== null && typeof features === "object" && !Array.isArray(features)
    ? Object.entries(features)
    : [];

  return (
    <div className="space-y-4 overflow-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="Code" className="size-5" />
        <h2 className="min-w-0 flex-1 truncate font-semibold">{metadata.firmwarePath.split("/").at(-1)}</h2>
        <Badge variant="outline">{binary ? "Binary metadata" : "Unknown type · safe view"}</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Manifest identity</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Architecture</dt><dd>{nullableField(metadata.fields, "architecture")}</dd></div>
            <div><dt className="text-muted-foreground">Size</dt><dd>{metadata.size === null ? "Unknown" : `${metadata.size.toLocaleString()} bytes`}</dd></div>
            <div><dt className="text-muted-foreground">Mode</dt><dd>{nullableField(metadata.fields, "mode")}</dd></div>
            <div><dt className="text-muted-foreground">Owner</dt><dd>{nullableField(metadata.fields, "uid")}:{nullableField(metadata.fields, "gid")}</dd></div>
            <div><dt className="text-muted-foreground">Set-ID</dt><dd>{metadata.fields.setuid === true ? "setuid " : ""}{metadata.fields.setgid === true ? "setgid" : metadata.fields.setuid === true ? "" : "None"}</dd></div>
            <div><dt className="text-muted-foreground">Type</dt><dd>{fullType ?? metadata.mediaType ?? "Unknown"}</dd></div>
          </dl>
          <p className="mt-4 break-all font-mono text-xs text-muted-foreground">SHA-256 {metadata.fileSha256}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Cached security features</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {securityFeatures.length > 0
            ? securityFeatures.map(([name, value]) => <Badge key={name} variant="outline">{name}: {String(value)}</Badge>)
            : <span className="text-sm text-muted-foreground">Unknown — no Tier 0 analysis is cached.</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Hex preview · first {metadata.previewBytes} bytes</CardTitle></CardHeader>
        <CardContent>
          {metadata.previewHex ? (
            <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-5" aria-label="256-byte bounded hex preview">{formatHex(metadata.previewHex).join("\n")}</pre>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Bytes are absent from this metadata-only mount. Raw binary is not requested or rendered.</p>
              <Button size="sm" onClick={() => void hydrate()} disabled={hydrating}>
                {hydrating ? <Icon name="Loading" className="mr-1.5 size-4 animate-spin" /> : <Icon name="Download" className="mr-1.5 size-4" />}
                Hydrate this file
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {adminDenied ? (
        <Alert variant="destructive"><Icon name="Lock" className="size-4" /><AlertTitle>Elevated permission required</AlertTitle><AlertDescription>Firmware bytes require org-admin VIEW_ANY_PROJECT_FILE. Ask an org admin for elevated permission, or use Local image with standalone unpack.</AlertDescription></Alert>
      ) : error ? (
        <Alert variant="destructive"><AlertDescription>{error} The verified metadata above remains available.</AlertDescription></Alert>
      ) : null}
    </div>
  );
}
