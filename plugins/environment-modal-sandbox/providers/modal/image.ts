import type { PluginMachineProviderProgress } from "@get-bb/plugin-sdk/machine-provider";
import { ModalClient, NotFoundError } from "modal";
import { z } from "zod";
import { readStandardImage } from "../../standard-image.js";
import type { ModalCredentials } from "./client.js";

export interface ModalImageRequest {
  appName: string;
  displayName: string;
  dockerfile: string;
  signal: AbortSignal;
  report: PluginMachineProviderProgress;
}

export async function ensureModalImage(
  credentials: ModalCredentials,
  request: ModalImageRequest,
): Promise<string> {
  request.signal.throwIfAborted();
  const definition = await readStandardImage(request.dockerfile);
  const client = new ModalClient({
    ...credentials,
    grpcMiddleware: [
      async function* (call, options) {
        const responses = call.next(call.request, options);
        while (true) {
          const next = await responses.next();
          if (next.done) return next.value;
          const response = next.value;
          if (
            call.method.path === "/modal.client.ModalClient/ImageJoinStreaming"
          ) {
            const parsed = z
              .object({ taskLogs: z.array(z.object({ data: z.string() })) })
              .safeParse(response);
            if (parsed.success)
              for (const log of parsed.data.taskLogs)
                request.report.log(log.data);
          }
          yield response;
        }
      },
    ],
  });
  try {
    try {
      const existing = await client.images.fromName(definition.name);
      request.signal.throwIfAborted();
      request.report.log(`Reusing the ${request.displayName} Modal image`);
      return existing.imageId;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
    request.signal.throwIfAborted();
    request.report.step(
      `Building the ${request.displayName} Modal image (first launch)…`,
    );
    const app = await client.apps.fromName(request.appName, {
      createIfMissing: true,
    });
    request.signal.throwIfAborted();
    const image = await client.images
      .fromRegistry(definition.reference)
      .dockerfileCommands(definition.commands)
      .build(app);
    await image.publish(definition.name);
    request.signal.throwIfAborted();
    request.report.log(`${request.displayName} Modal image ready`);
    return image.imageId;
  } finally {
    client.close();
  }
}
