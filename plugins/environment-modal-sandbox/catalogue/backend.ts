import type { BaseArtifact } from "./artifact.js";
import { ModalClient, NotFoundError } from "modal";
import { z } from "zod";
import { baseCommands, baseManifest } from "./base.js";
import { quote, translateDockerfile } from "./dockerfile.js";
import { hash } from "./model.js";
import type { ModalCredentials } from "../sandbox-backend.js";

export interface ImageBuildRequest {
  name: string;
  appName: string;
  dockerfileText: string;
  baseArtifact: BaseArtifact | null;
  files: ReadonlyMap<string, { data: Buffer; executable: boolean }>;
}
export interface ImageBuildHooks {
  signal?: AbortSignal;
  log(text: string): void;
  allocated(imageId: string): void;
}
export interface ImageBackend {
  accountIdentity(): Promise<string>;
  build(request: ImageBuildRequest, hooks: ImageBuildHooks): Promise<string>;
  reconcile(name: string): Promise<string | null>;
  delete(imageId: string): Promise<void>;
  resolve(imageId: string): Promise<string | null>;
}
export type ImageBackendFactory = (
  credentials: ModalCredentials,
) => ImageBackend;
export const createImageBackend: ImageBackendFactory = (credentials) => {
  async function lookup(operation: (client: ModalClient) => Promise<string>) {
    const client = new ModalClient(credentials);
    try {
      return await operation(client);
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    } finally {
      client.close();
    }
  }
  return {
    async accountIdentity() {
      const identity = await lookup(async (client) => {
        const token = await client.cpClient.tokenInfoGet({});
        if (!token.workspaceId)
          throw new Error("Modal did not return an account identity");
        return hash(token.workspaceId);
      });
      if (!identity) throw new Error("Modal account was not found");
      return identity;
    },
    async build(request, hooks) {
      type Middleware = NonNullable<
        NonNullable<
          ConstructorParameters<typeof ModalClient>[0]
        >["grpcMiddleware"]
      >[number];
      const middleware: Middleware = async function* (call, options) {
        const iterator = call.next(call.request, options);
        for (;;) {
          const item = await iterator.next();
          if (call.method.path.endsWith("/ImageJoinStreaming")) {
            const logs = z
              .object({ taskLogs: z.array(z.object({ data: z.string() })) })
              .safeParse(item.value);
            if (logs.success)
              for (const log of logs.data.taskLogs)
                if (log.data) hooks.log(log.data);
          }
          if (item.done) {
            if (call.method.path.endsWith("/ImageGetOrCreate")) {
              const image = z
                .object({ imageId: z.string().min(1) })
                .safeParse(item.value);
              const request = z
                .object({
                  image: z.object({ dockerfileCommands: z.array(z.string()) }),
                })
                .safeParse(call.request);
              if (
                image.success &&
                request.success &&
                request.data.image.dockerfileCommands.some((command) =>
                  command.includes("/opt/bb-project/image-manifest.json"),
                )
              )
                hooks.allocated(image.data.imageId);
            }
            return item.value;
          }
          yield item.value;
        }
      };
      const client = new ModalClient({
        ...credentials,
        grpcMiddleware: [middleware],
      });
      try {
        const app = await client.apps.fromName(request.appName, {
          createIfMissing: true,
        });
        const artifact = request.baseArtifact;
        if (!artifact)
          throw new Error(
            "Build requires the server’s exact credential-free bb package; explicitly rebuild",
          );
        const commands = [
          ...baseCommands,
          ...translateDockerfile(
            "COPY bb-app.tgz /tmp/bb-app.tgz",
            new Map([
              ["bb-app.tgz", { data: artifact.data, executable: false }],
            ]),
          ),
          `RUN echo "${artifact.metadata.sha256}  /tmp/bb-app.tgz" | sha256sum -c - && npm install -g /tmp/bb-app.tgz && rm /tmp/bb-app.tgz`,
          "RUN node --version && npm --version && git --version && python3 --version && bb --version && bb machine enroll --help && codex --version && claude --version",
          ...translateDockerfile(request.dockerfileText, request.files),
          "RUN mkdir -p /opt/bb-project && printf '%s' " +
            quote(
              JSON.stringify({
                version: 1,
                name: request.name,
                base: baseManifest.version,
                bbPackage: artifact.metadata,
              }),
            ) +
            " > /opt/bb-project/image-manifest.json",
        ];
        hooks.log(`Building ${request.name} with ${baseManifest.builder}`);
        const image = await client.images
          .fromRegistry(baseManifest.registry)
          .dockerfileCommands(commands)
          .build(app);
        hooks.allocated(image.imageId);
        await image.publish(request.name);
        hooks.log(`Published ${request.name}`);
        return image.imageId;
      } finally {
        client.close();
      }
    },
    reconcile(name) {
      return lookup(
        async (client) => (await client.images.fromName(name)).imageId,
      );
    },
    resolve(imageId) {
      return lookup(
        async (client) => (await client.images.fromId(imageId)).imageId,
      );
    },
    async delete(imageId) {
      await lookup(async (client) => {
        await client.images.delete(imageId);
        return imageId;
      });
    },
  };
};
