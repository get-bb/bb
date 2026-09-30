import { z } from "zod";

export const storedSessionSchema = z.object({
  serverUrl: z.string().min(1),
  credential: z.string().min(1),
  session: z.object({
    cookie: z.object({
      domain: z.string().min(1),
      expiresAt: z.number().int().positive(),
      name: z.string().min(1),
      value: z.string().min(1),
    }),
  }),
});

export type StoredSession = z.infer<typeof storedSessionSchema>;

export interface SessionCacheLike {
  read(profileId: string): Promise<StoredSession | null>;
  write(profileId: string, stored: StoredSession): Promise<void>;
  clear(profileId: string): Promise<void>;
}
