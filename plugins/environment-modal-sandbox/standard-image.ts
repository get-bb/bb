import { z } from "zod";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ModalClient, NotFoundError } from "modal";
import type { PluginMachineProviderProgress } from "@get-bb/plugin-sdk/machine-provider";
import type { ModalCredentials } from "./sandbox-backend.js";

export interface StandardImageRequest {
  appName: string;
  dockerfile: string;
  signal: AbortSignal;
  report: PluginMachineProviderProgress;
}

export async function readStandardDockerfile() {
  return readFile(new URL("./Dockerfile", import.meta.url), "utf8").catch(
    async (error: unknown) => {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
      return readFile(new URL("../Dockerfile", import.meta.url), "utf8");
    },
  );
}

export async function readStandardImage(override?: string) {
  const dockerfile = override ?? (await readStandardDockerfile());
  const lines = dockerfile
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const from = /^FROM (\S+)$/.exec(lines[0] ?? "");
  if (
    !from ||
    lines.slice(1).some((line) => !/^(RUN|ENV|WORKDIR|USER) /.test(line))
  )
    throw new Error(
      "The Modal Dockerfile requires one FROM followed by RUN, ENV, WORKDIR or USER instructions",
    );
  return {
    reference: from[1]!,
    commands: lines.slice(1),
    name: `bb-standard:${createHash("sha256").update(dockerfile).digest("hex")}`,
  };
}

export async function ensureStandardImage(
  credentials: ModalCredentials,
  request: StandardImageRequest,
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
      request.report.log("Reusing the standard Modal image");
      return existing.imageId;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
    request.signal.throwIfAborted();
    request.report.step("Building the standard Modal image (first launch)…");
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
    request.report.log("Standard Modal image ready");
    return image.imageId;
  } finally {
    client.close();
  }
}
