import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { readStandardDockerfile, readStandardImage } from "./standard-image.js";

export const dockerfileSchema = z.string().min(1).max(65_536);
const key = "dockerfile-override";

export function imageDefinition(bb: Pick<BbPluginApi, "storage">) {
  return {
    async get() {
      const stored = await bb.storage.kv.get<unknown>(key);
      return stored === undefined
        ? { dockerfile: await readStandardDockerfile(), customized: false }
        : { dockerfile: dockerfileSchema.parse(stored), customized: true };
    },
    async set(dockerfile: string) {
      const value = dockerfileSchema.parse(dockerfile);
      await readStandardImage(value);
      await bb.storage.kv.set(key, value);
      return { dockerfile: value, customized: true };
    },
    async reset() {
      await bb.storage.kv.delete(key);
      return { dockerfile: await readStandardDockerfile(), customized: false };
    },
  };
}

export type ImageDefinition = ReturnType<typeof imageDefinition>;
