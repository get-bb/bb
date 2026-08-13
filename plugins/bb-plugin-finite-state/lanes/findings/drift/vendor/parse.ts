import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

export type VendorVexFormat = "cyclonedx" | "csaf" | "openvex";

export const MAX_VENDOR_VEX_BYTES = 5 * 1024 * 1024;

export class VendorVexParseError extends Error {
  constructor(
    readonly code: "VENDOR_FILE_INVALID" | "VENDOR_FILE_OVERSIZED" | "VENDOR_JSON_INVALID" | "VENDOR_FORMAT_UNRECOGNIZED",
    message: string,
  ) {
    super(message);
    this.name = "VendorVexParseError";
  }
}

export interface ParsedVendorVex {
  format: VendorVexFormat;
  digest: string;
  documentId: string;
  file: string;
  document: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function detect(document: Record<string, unknown>): VendorVexFormat | null {
  if (document["bomFormat"] === "CycloneDX" && Array.isArray(document["vulnerabilities"])) return "cyclonedx";
  const metadata = record(document["document"]);
  if (
    metadata !== null
    && (metadata["category"] === "csaf_vex" || metadata["category"] === "vex")
    && Array.isArray(document["vulnerabilities"])
  ) return "csaf";
  const context = document["@context"];
  if (typeof context === "string" && context.startsWith("https://openvex.dev/ns/") && Array.isArray(document["statements"])) {
    return "openvex";
  }
  return null;
}

function documentIdentity(format: VendorVexFormat, document: Record<string, unknown>, file: string): string {
  if (format === "cyclonedx") {
    const serial = document["serialNumber"];
    return typeof serial === "string" && serial.length > 0 ? serial : file;
  }
  if (format === "openvex") {
    const id = document["@id"];
    return typeof id === "string" && id.length > 0 ? id : file;
  }
  const metadata = record(document["document"]);
  const tracking = metadata === null ? null : record(metadata["tracking"]);
  const id = tracking?.["id"];
  return typeof id === "string" && id.length > 0 ? id : file;
}

export async function parseVendorVex(file: string): Promise<ParsedVendorVex> {
  let metadata;
  try {
    metadata = await lstat(file);
  } catch (error) {
    throw new VendorVexParseError("VENDOR_FILE_INVALID", `Vendor VEX file cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new VendorVexParseError("VENDOR_FILE_INVALID", "Vendor VEX input must be a regular file, not a symlink");
  }
  if (metadata.size > MAX_VENDOR_VEX_BYTES) {
    throw new VendorVexParseError("VENDOR_FILE_OVERSIZED", `Vendor VEX input exceeds ${MAX_VENDOR_VEX_BYTES} bytes`);
  }
  const bytes = await readFile(file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new VendorVexParseError("VENDOR_JSON_INVALID", "Vendor VEX input is not valid JSON");
  }
  const document = record(parsed);
  if (document === null) throw new VendorVexParseError("VENDOR_JSON_INVALID", "Vendor VEX document must be a JSON object");
  const format = detect(document);
  if (format === null) {
    throw new VendorVexParseError("VENDOR_FORMAT_UNRECOGNIZED", "Document is not recognized as CycloneDX VEX, CSAF VEX, or OpenVEX");
  }
  return {
    format,
    digest: createHash("sha256").update(bytes).digest("hex"),
    documentId: documentIdentity(format, document, file),
    file,
    document,
  };
}
