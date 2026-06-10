import { z } from "zod";

// How a child thread was spawned from its parent. null (absent) for threads
// created normally, including non-child threads. The thread-start turn shape
// alone is ambiguous (fork and side-chat both produce agent-initiated starts),
// so this is the explicit discriminator. Lives in its own module so the DB
// schema can import the value tuple via a narrow subpath without pulling the
// full domain barrel into drizzle-kit.
export const threadChildOriginValues = ["fork", "side-chat"] as const;
export const threadChildOriginSchema = z.enum(threadChildOriginValues);
export type ThreadChildOrigin = z.infer<typeof threadChildOriginSchema>;
