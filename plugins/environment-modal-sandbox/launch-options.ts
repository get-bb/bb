import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ImageDefinition } from "./image-definition.js";
import { dockerfileSchema } from "./image-definition.js";
import { readStandardImage } from "./standard-image.js";

const nameSchema = z.string().trim().min(1).max(80);

export const sandboxPresetSchema = z
  .object({
    name: nameSchema,
    cpu: z.number().positive(),
    memoryMiB: z.number().int().positive(),
  })
  .strict();

export const modalImageSchema = z.discriminatedUnion("source", [
  z
    .object({
      name: nameSchema,
      source: z.literal("dockerfile"),
      dockerfile: dockerfileSchema,
    })
    .strict(),
  z
    .object({
      name: nameSchema,
      source: z.literal("image-id"),
      imageId: z.string().trim().min(1).max(200),
    })
    .strict(),
]);

export const modalLaunchOptionsSchema = z
  .object({
    presets: z.array(sandboxPresetSchema).max(20),
    images: z.array(modalImageSchema).min(1).max(20),
  })
  .strict();

export type SandboxPreset = z.infer<typeof sandboxPresetSchema>;
export type ModalImage = z.infer<typeof modalImageSchema>;
export type ModalLaunchOptions = z.infer<typeof modalLaunchOptionsSchema>;

const PRESETS_KEY = "sandbox-size-presets";
const EXTRA_IMAGES_KEY = "named-images";

function requireUniqueNames(
  kind: string,
  entries: readonly { name: string }[],
): void {
  const names = new Set<string>();
  for (const entry of entries) {
    const normalized = entry.name.toLocaleLowerCase();
    if (names.has(normalized)) {
      throw new Error(`${kind} names must be unique.`);
    }
    names.add(normalized);
  }
}

export function modalLaunchOptions(
  bb: Pick<BbPluginApi, "storage">,
  image: ImageDefinition,
) {
  async function get(): Promise<ModalLaunchOptions> {
    const [storedPresets, storedImages, standard] = await Promise.all([
      bb.storage.kv.get<unknown>(PRESETS_KEY),
      bb.storage.kv.get<unknown>(EXTRA_IMAGES_KEY),
      image.get(),
    ]);
    const presets =
      storedPresets === undefined
        ? []
        : z.array(sandboxPresetSchema).max(20).parse(storedPresets);
    const extraImages =
      storedImages === undefined
        ? []
        : z.array(modalImageSchema).max(19).parse(storedImages);
    const options = {
      presets,
      images: [
        {
          name: "Default",
          source: "dockerfile" as const,
          dockerfile: standard.dockerfile,
        },
        ...extraImages,
      ],
    };
    requireUniqueNames("Preset", options.presets);
    requireUniqueNames("Image", options.images);
    return options;
  }

  async function set(value: ModalLaunchOptions): Promise<ModalLaunchOptions> {
    const parsed = modalLaunchOptionsSchema.parse(value);
    const [standard, ...extraImages] = parsed.images;
    if (standard?.name !== "Default" || standard.source !== "dockerfile") {
      throw new Error(
        'The first image must be the bundled "Default" Dockerfile.',
      );
    }
    requireUniqueNames("Preset", parsed.presets);
    requireUniqueNames("Image", parsed.images);
    await Promise.all(
      parsed.images.map((entry) =>
        entry.source === "dockerfile"
          ? readStandardImage(entry.dockerfile)
          : Promise.resolve(),
      ),
    );
    await image.set(standard.dockerfile);
    await Promise.all([
      bb.storage.kv.set(PRESETS_KEY, parsed.presets),
      bb.storage.kv.set(EXTRA_IMAGES_KEY, extraImages),
    ]);
    return get();
  }

  return { get, set };
}

export type ModalLaunchOptionsStore = ReturnType<typeof modalLaunchOptions>;
