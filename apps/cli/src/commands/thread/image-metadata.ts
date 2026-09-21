import { Command } from "commander";
import { threadImageMetadataSchema } from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { requireThreadIdOrSelf } from "../helpers.js";

export function registerImageMetadataCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("image-metadata [id]")
    .description(
      "Read learned image dimensions or record dimensions for a source",
    )
    .option("--self", "Use the current thread")
    .option(
      "--source <url>",
      "HTTP URL or origin-relative image path to record",
    )
    .option("--width <pixels>", "Intrinsic image width")
    .option("--height <pixels>", "Intrinsic image height")
    .option("--etag <etag>", "Image response ETag, when available")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          id: string | undefined,
          opts: {
            self?: boolean;
            source?: string;
            width?: string;
            height?: string;
            etag?: string;
          },
        ) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const sdk = createCliBbSdk(getUrl());
          if (
            opts.source !== undefined ||
            opts.width !== undefined ||
            opts.height !== undefined ||
            opts.etag !== undefined
          ) {
            const metadata = threadImageMetadataSchema.parse({
              source: opts.source,
              width: Number(opts.width),
              height: Number(opts.height),
              etag: opts.etag ?? null,
            });
            console.log(
              JSON.stringify(
                await sdk.threads.saveImageMetadata({ threadId, ...metadata }),
                null,
                2,
              ),
            );
          } else {
            const timeline = await sdk.threads.timeline({
              threadId,
              summaryOnly: "true",
            });
            console.log(JSON.stringify(timeline.imageMetadata ?? [], null, 2));
          }
        },
      ),
    );
}
