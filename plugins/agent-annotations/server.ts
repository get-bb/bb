import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  ANNOTATION_MENTION_PROVIDER_ID,
  annotationRecordSchema,
  formatAnnotationContext,
} from "./annotations.js";

const STORAGE_PREFIX = "annotation:";

export const agentAnnotationsRpcContract = defineRpcContract({
  save: {
    input: annotationRecordSchema,
    output: z.object({ id: z.string() }).strict(),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.rpc.register(agentAnnotationsRpcContract, {
    async save(annotation) {
      const id = randomUUID();
      await bb.storage.kv.set(`${STORAGE_PREFIX}${id}`, annotation);
      return { id };
    },
  });
  bb.ui.registerMentionProvider({
    id: ANNOTATION_MENTION_PROVIDER_ID,
    label: "Browser annotations",
    search: () => [],
    async resolve(id) {
      const parsed = annotationRecordSchema.safeParse(
        await bb.storage.kv.get(`${STORAGE_PREFIX}${id}`),
      );
      if (!parsed.success) {
        throw new Error("This browser annotation is no longer available");
      }
      return { context: formatAnnotationContext(parsed.data) };
    },
  });
}
