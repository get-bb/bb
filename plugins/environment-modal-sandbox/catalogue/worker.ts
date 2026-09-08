import { artifactMetadataSchema } from "./artifact.js";
import { spawn } from "node:child_process";
import { z } from "zod";
import { createImageBackend, type ImageBackendFactory } from "./backend.js";

const requestSchema = z
  .object({
    credentials: z.object({ tokenId: z.string(), tokenSecret: z.string() }),
    baseArtifact: z
      .object({ metadata: artifactMetadataSchema, data: z.string() })
      .nullable(),
    name: z.string(),
    appName: z.string(),
    dockerfileText: z.string(),
    files: z.array(
      z.object({ path: z.string(), data: z.string(), executable: z.boolean() }),
    ),
  })
  .strict();
const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("log"), text: z.string() }),
  z.object({ type: z.literal("allocated"), imageId: z.string() }),
  z.object({ type: z.literal("result"), imageId: z.string() }),
  z.object({ type: z.literal("error"), text: z.string() }),
]);
export async function runImageBuildWorker() {
  const input = requestSchema.parse(
    await new Promise<unknown>((resolve) => process.once("message", resolve)),
  );
  const send = (message: z.infer<typeof messageSchema>) =>
    process.send?.(message);
  try {
    const backend = createImageBackend(input.credentials);
    const imageId = await backend.build(
      {
        name: input.name,
        appName: input.appName,
        dockerfileText: input.dockerfileText,
        baseArtifact: input.baseArtifact
          ? {
              metadata: input.baseArtifact.metadata,
              data: Buffer.from(input.baseArtifact.data, "base64"),
            }
          : null,
        files: new Map(
          input.files.map((file) => [
            file.path,
            {
              data: Buffer.from(file.data, "base64"),
              executable: file.executable,
            },
          ]),
        ),
      },
      {
        log: (text) => send({ type: "log", text }),
        allocated: (imageId) => send({ type: "allocated", imageId }),
      },
    );
    send({ type: "result", imageId });
  } catch (error) {
    send({
      type: "error",
      text: error instanceof Error ? error.message : String(error),
    });
  } finally {
    process.disconnect?.();
  }
}
export function createWorkerImageBackend(
  entryUrl: string,
): ImageBackendFactory {
  return (credentials) => ({
    ...createImageBackend(credentials),
    async build(request, hooks) {
      const child = spawn(
        process.execPath,
        [
          ...(entryUrl.endsWith(".ts")
            ? ["--conditions=source", "--import", "tsx"]
            : []),
          "--input-type=module",
          "-e",
          `import { runImageBuildWorker } from ${JSON.stringify(entryUrl)}; await runImageBuildWorker();`,
        ],
        {
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            TMPDIR: process.env.TMPDIR,
            LANG: "C.UTF-8",
            ELECTRON_RUN_AS_NODE: "1",
          },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      const log = (data: Buffer) => hooks.log(data.toString("utf8"));
      child.stdout?.on("data", log);
      child.stderr?.on("data", log);
      const onAbort = () => child.kill();
      hooks.signal?.addEventListener("abort", onAbort, { once: true });
      if (hooks.signal?.aborted) child.kill();
      try {
        return await new Promise<string>((resolve, reject) => {
          child.on("error", reject);
          child.on("exit", (code) =>
            reject(
              new Error(
                `Build worker stopped (${code}); vendor outcome unknown`,
              ),
            ),
          );
          child.on("message", (value) => {
            const parsed = messageSchema.safeParse(value);
            if (!parsed.success) {
              reject(new Error("Malformed build worker response"));
              return;
            }
            const message = parsed.data;
            if (message.type === "log") hooks.log(message.text);
            else if (message.type === "allocated")
              hooks.allocated(message.imageId);
            else if (message.type === "result") resolve(message.imageId);
            else reject(new Error(message.text));
          });
          child.send(
            {
              credentials,
              name: request.name,
              appName: request.appName,
              dockerfileText: request.dockerfileText,
              baseArtifact: request.baseArtifact
                ? {
                    metadata: request.baseArtifact.metadata,
                    data: request.baseArtifact.data.toString("base64"),
                  }
                : null,
              files: [...request.files].map(([path, file]) => ({
                path,
                data: file.data.toString("base64"),
                executable: file.executable,
              })),
            },
            (error) => {
              if (error) reject(error);
            },
          );
        });
      } finally {
        hooks.signal?.removeEventListener("abort", onAbort);
        child.kill();
      }
    },
  });
}
