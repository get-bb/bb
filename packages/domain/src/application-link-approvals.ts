import { z } from "zod";
import { parseApplicationUrl } from "./application-url.js";

export const applicationLinkSchemeSchema = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9+.-]*$/u)
  .refine((scheme) => parseApplicationUrl(`${scheme}:`) !== null);
export const applicationLinkApprovalsSchema = z
  .array(applicationLinkSchemeSchema)
  .max(256);
const stateSchema = z.object({
  revision: z.number().int().nonnegative(),
  schemes: applicationLinkApprovalsSchema,
});
export const APPLICATION_LINK_APPROVALS_STORAGE_KEY =
  "bb.applicationLinkApprovals.v1";

export function createApplicationLinkApprovals(storage: {
  read(): string | null;
  write(value: string): void;
}) {
  const read = (): { revision: number; schemes: string[] } => {
    const raw = storage.read();
    try {
      const parsed = stateSchema.safeParse(
        raw === null ? null : JSON.parse(raw),
      );
      if (parsed.success) return parsed.data;
    } catch {}
    return { revision: 0, schemes: [] };
  };
  return {
    list: () => [...new Set(read().schemes)].sort(),
    revision: () => read().revision,
    allow(scheme: string, expectedRevision: number) {
      const valid = applicationLinkSchemeSchema.parse(scheme);
      const current = read();
      if (
        current.revision !== expectedRevision ||
        current.schemes.includes(valid)
      )
        return;
      storage.write(
        JSON.stringify({
          revision: current.revision + 1,
          schemes: applicationLinkApprovalsSchema.parse([
            ...current.schemes,
            valid,
          ]),
        }),
      );
    },
    revoke(scheme: string | null) {
      if (scheme !== null) applicationLinkSchemeSchema.parse(scheme);
      const current = read();
      storage.write(
        JSON.stringify({
          revision: current.revision + 1,
          schemes:
            scheme === null
              ? []
              : current.schemes.filter((item) => item !== scheme),
        }),
      );
    },
  };
}
export interface ApplicationLinkApprovals {
  list(): string[];
  revision(): number;
  allow(scheme: string, expectedRevision: number): void | Promise<void>;
  revoke(scheme: string | null): void | Promise<void>;
}
