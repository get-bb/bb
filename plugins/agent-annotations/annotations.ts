import { z } from "zod";

export const ANNOTATION_MENTION_PROVIDER_ID = "annotation";

const rectSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .strict();

const pageElementSchema = z
  .object({
    tagName: z.string().max(64),
    name: z.string().max(200),
    selector: z.string().max(2000),
    text: z.string().max(400),
    attributes: z.record(z.string(), z.string().max(400)),
    rect: rectSchema,
    styles: z.record(z.string(), z.string().max(400)),
  })
  .strict();

export const reactComponentSchema = z
  .object({
    name: z.string().min(1).max(200),
    source: z.string().max(1000).nullable(),
  })
  .strict();
export type ReactComponent = z.infer<typeof reactComponentSchema>;

export const pageAnnotationSchema = z
  .object({
    id: z.string().min(1).max(64),
    number: z.number().int().positive(),
    comment: z.string().trim().min(1).max(4000),
    url: z.string().max(4096),
    title: z.string().max(1024),
    viewport: z.object({ width: z.number(), height: z.number() }).strict(),
    element: pageElementSchema,
  })
  .strict();
export type PageAnnotation = z.infer<typeof pageAnnotationSchema>;

export const pageStateSchema = z
  .object({
    active: z.boolean(),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type PageState = z.infer<typeof pageStateSchema>;

export const pageMessageSchema = z.discriminatedUnion("type", [
  pageStateSchema.extend({ type: z.literal("state") }).strict(),
  z
    .object({
      type: z.literal("annotation"),
      annotation: pageAnnotationSchema,
    })
    .strict(),
]);

export const reactProbeSchema = z
  .object({ components: z.array(reactComponentSchema).max(12) })
  .strict()
  .nullable();

export const annotationRecordSchema = pageAnnotationSchema
  .extend({ components: z.array(reactComponentSchema).max(12) })
  .strict();
export type AnnotationRecord = z.infer<typeof annotationRecordSchema>;

export function annotationMentionLabel(annotation: PageAnnotation): string {
  const comment = annotation.comment.replace(/\s+/g, " ").trim();
  const shortComment =
    comment.length > 40 ? `${comment.slice(0, 39).trimEnd()}…` : comment;
  return `${annotation.number}. ${annotation.element.tagName}: ${shortComment}`;
}

function formatComponent(component: ReactComponent): string {
  return component.source === null
    ? component.name
    : `${component.name} (${component.source})`;
}

export function formatAnnotationContext(record: AnnotationRecord): string {
  const page =
    record.title.length > 0 ? `"${record.title}" (${record.url})` : record.url;
  const lines = [
    `# Browser annotation ${record.number}`,
    "",
    `The user selected an element on ${page} and commented on it.`,
    "",
    "## Comment",
    "",
    record.comment,
    "",
    "## Element",
    "",
    `- Element: \`${record.element.name}\``,
    `- Selector: \`${record.element.selector}\``,
  ];
  if (record.components.length > 0) {
    lines.push(
      `- React components, innermost first: ${record.components.map(formatComponent).join(" › ")}`,
    );
  }
  if (record.element.text.length > 0) {
    lines.push(`- Text: ${JSON.stringify(record.element.text)}`);
  }
  const attributes = Object.entries(record.element.attributes);
  if (attributes.length > 0) {
    lines.push(
      `- Attributes: ${attributes.map(([name, value]) => `${name}=${JSON.stringify(value)}`).join(", ")}`,
    );
  }
  const { rect, styles } = record.element;
  lines.push(
    `- Box: x=${rect.x}, y=${rect.y}, ${rect.width}×${rect.height}px in a ${record.viewport.width}×${record.viewport.height}px viewport`,
  );
  const styleEntries = Object.entries(styles);
  if (styleEntries.length > 0) {
    lines.push(
      "",
      "## Computed styles",
      "",
      ...styleEntries.map(([name, value]) => `- ${name}: ${value}`),
    );
  }
  return lines.join("\n");
}
