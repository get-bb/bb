import { z } from "zod";

// How a thread was spawned from a source thread. null (absent) for threads
// created normally. The thread-start turn shape alone is ambiguous (a fork and
// a normal start both produce agent-initiated starts), so this is the explicit
// discriminator. Lives in its own module so the DB schema can import the value
// tuple via a narrow subpath without pulling the full domain barrel into
// drizzle-kit.
//
// Side chats used to be their own origin kind. They are now the builtin
// side-chat plugin's hidden forks, identified by `originPluginId` — migration
// 0084 moved every legacy row over.
export const threadOriginKindValues = ["fork"] as const;
export const threadOriginKindSchema = z.enum(threadOriginKindValues);
export type ThreadOriginKind = z.infer<typeof threadOriginKindSchema>;
