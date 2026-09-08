import { z } from "zod";
import { createHash } from "node:crypto";
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const artifactMetadataSchema = z
  .object({
    sha256: hashSchema,
    version: z.string().min(1),
    protocolVersion: z.number().int().positive(),
  })
  .strict();
export type ArtifactMetadata = z.infer<typeof artifactMetadataSchema>;
export interface BaseArtifact {
  metadata: ArtifactMetadata;
  data: Buffer;
}
export async function fetchBaseArtifact(
  serverUrl: string,
): Promise<BaseArtifact> {
  const versionResponse = await fetch(`${serverUrl}/install/version`);
  if (!versionResponse.ok)
    throw new Error("Cannot resolve the server's bb package version");
  const version = z
    .object({
      version: z.string(),
      protocolVersion: z.number().int().positive(),
    })
    .parse(await versionResponse.json());
  const response = await fetch(`${serverUrl}/install/bb-app.tgz`);
  if (!response.ok)
    throw new Error("Cannot fetch the server's credential-free bb package");
  const digest = hashSchema.parse(response.headers.get("x-bb-artifact-sha256"));
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > 64 * 1024 * 1024)
    throw new Error("The bb base package exceeds 64 MiB");
  if (hash(data) !== digest)
    throw new Error("The bb base package failed SHA-256 verification");
  return { metadata: { ...version, sha256: digest }, data };
}
