import { z } from "zod";

const pluginAdminHttpErrorSchema = z.object({ status: z.number() });

export function pluginAdminErrorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    const parsed = pluginAdminHttpErrorSchema.safeParse(cause);
    if (parsed.success) {
      const prefix = `HTTP ${parsed.data.status}: `;
      return cause.message.startsWith(prefix)
        ? cause.message.slice(prefix.length)
        : cause.message;
    }
    return cause.message;
  }
  return String(cause);
}
