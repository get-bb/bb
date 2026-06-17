import { z } from "zod";

// How a thread was spawned from a source thread. null (absent) for threads
// created normally. The thread-start turn shape alone is ambiguous (fork and
// side-chat both produce agent-initiated starts), so this is the explicit
// discriminator. Lives in its own module so the DB schema can import the value
// tuple via a narrow subpath without pulling the full domain barrel into
// drizzle-kit.
export const threadOriginKindValues = ["fork", "side-chat"] as const;
export const threadOriginKindSchema = z.enum(threadOriginKindValues);
export type ThreadOriginKind = z.infer<typeof threadOriginKindSchema>;

/** @deprecated Use threadOriginKindValues. */
export const threadChildOriginValues = threadOriginKindValues;
/** @deprecated Use threadOriginKindSchema. */
export const threadChildOriginSchema = threadOriginKindSchema;
/** @deprecated Use ThreadOriginKind. */
export type ThreadChildOrigin = ThreadOriginKind;
