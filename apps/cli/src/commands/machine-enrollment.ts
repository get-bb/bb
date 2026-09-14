import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
  symlink,
  access,
} from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { z } from "zod";

const serverUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  });
const bootstrapSchema = z.strictObject({
  hostId: z.string().min(1),
  serverUrl: serverUrlSchema,
  headers: z.record(z.string(), z.string()).optional(),
  credential: z.string().min(1),
  expiresAt: z.number().finite().positive(),
});
const configSchema = z.looseObject({
  serverUrl: serverUrlSchema.optional(),
  serverHeaders: z.record(z.string(), z.string()).optional(),
});
const authSchema = z.object({
  hostId: z.string().min(1),
  hostKey: z.string().min(1),
});

function normalizeUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.href.replace(/\/+$/u, "");
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw new Error("Could not read machine identity state");
  }
}

async function atomicWrite(path: string, value: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, value, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function reservePort(dataDir: string): Promise<void> {
  const path = join(dataDir, "host-daemon-port");
  if ((await readOptional(path)) !== null) return;
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Could not choose a machine daemon port");
    await atomicWrite(path, `${address.port}\n`);
  } finally {
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export interface MachineEnrollmentOptions {
  bootstrapFile?: string;
  bootstrapEnv?: string;
}

export async function enrollMachine(
  options: MachineEnrollmentOptions,
  runtime: {
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
    fetchFn?: typeof fetch;
  } = {},
): Promise<{ hostId: string }> {
  const env = runtime.env ?? process.env;
  if (Boolean(options.bootstrapFile) === Boolean(options.bootstrapEnv))
    throw new Error(
      "Specify exactly one of --bootstrap-file or --bootstrap-env",
    );
  let input: string;
  if (options.bootstrapEnv) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.bootstrapEnv))
      throw new Error("Invalid bootstrap environment variable name");
    const value = env[options.bootstrapEnv];
    if (!value) throw new Error("Bootstrap environment variable is empty");
    input = value;
    delete env[options.bootstrapEnv];
  } else {
    const value = await readOptional(options.bootstrapFile!);
    if (value === null) throw new Error("Bootstrap file was not found");
    input = value;
  }
  let bootstrap: z.infer<typeof bootstrapSchema>;
  try {
    bootstrap = bootstrapSchema.parse(JSON.parse(input));
  } catch {
    throw new Error("Invalid machine enrollment bootstrap");
  }
  const home = runtime.homeDir ?? homedir();
  const serverUrl = normalizeUrl(bootstrap.serverUrl);
  const dataDir = resolve(
    env.BB_DATA_DIR ??
      join(
        home,
        ".bb-machines",
        new URL(bootstrap.serverUrl).host.replace(/[^a-zA-Z0-9.-]/gu, "-"),
      ),
  );
  if (dataDir === resolve(home, ".bb"))
    throw new Error(
      "Machine enrollment cannot use the default BB data directory",
    );
  const existingAuth = await readOptional(join(dataDir, "auth.json"));
  if (existingAuth !== null) {
    let auth: z.infer<typeof authSchema>;
    let config: z.infer<typeof configSchema>;
    try {
      auth = authSchema.parse(JSON.parse(existingAuth));
      config = configSchema.parse(
        JSON.parse((await readOptional(join(dataDir, "config.json"))) ?? "{}"),
      );
    } catch {
      throw new Error("Invalid persisted machine identity");
    }
    const persistedId = (await readOptional(join(dataDir, "host-id")))?.trim();
    if (
      auth.hostId !== bootstrap.hostId ||
      (persistedId && persistedId !== bootstrap.hostId) ||
      (config.serverUrl && normalizeUrl(config.serverUrl) !== serverUrl)
    )
      throw new Error("Refusing to overwrite a different machine identity");
    if (!config.serverUrl)
      throw new Error("Persisted machine server identity is missing");
    return { hostId: auth.hostId };
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  let config: z.infer<typeof configSchema>;
  let auth: z.infer<typeof authSchema> | null;
  try {
    config = configSchema.parse(
      JSON.parse((await readOptional(join(dataDir, "config.json"))) ?? "{}"),
    );
    const rawAuth = await readOptional(join(dataDir, "auth.json"));
    auth = rawAuth === null ? null : authSchema.parse(JSON.parse(rawAuth));
  } catch {
    throw new Error("Invalid persisted machine identity");
  }
  const persistedId = (await readOptional(join(dataDir, "host-id")))?.trim();
  if (
    (auth && auth.hostId !== bootstrap.hostId) ||
    (persistedId && persistedId !== bootstrap.hostId) ||
    (config.serverUrl && normalizeUrl(config.serverUrl) !== serverUrl)
  )
    throw new Error("Refusing to overwrite a different machine identity");
  async function prepareRuntime(): Promise<void> {
    await reservePort(dataDir);
    const launcher = join(dataDir, "npm", "bin", "bb-app");
    try {
      await access(launcher);
    } catch {
      const result = await promisify(execFile)(
        "sh",
        ["-c", "command -v bb-app"],
        { env },
      ).catch(() => null);
      if (result?.stdout.trim()) {
        await mkdir(join(dataDir, "npm", "bin"), { recursive: true });
        await symlink(result.stdout.trim(), launcher);
      }
    }
  }
  if (auth) {
    if (!config.serverUrl)
      throw new Error("Persisted machine server identity is missing");
    await prepareRuntime();
    return { hostId: auth.hostId };
  }
  if (bootstrap.expiresAt <= Date.now())
    throw new Error("Machine enrollment bootstrap has expired");
  const fetchFn = runtime.fetchFn ?? fetch;
  const signal = AbortSignal.timeout(60_000);
  config = { ...config, serverUrl, serverHeaders: bootstrap.headers };
  await atomicWrite(
    join(dataDir, "config.json"),
    `${JSON.stringify(config)}\n`,
  );
  await atomicWrite(join(dataDir, "host-id"), `${bootstrap.hostId}\n`);
  await prepareRuntime();
  let enrolled: z.infer<typeof authSchema>;
  try {
    const response = await fetchFn(
      new URL("/internal/hosts/enroll", serverUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bootstrap.credential}`,
          ...config.serverHeaders,
        },
        body: JSON.stringify({
          hostId: bootstrap.hostId,
          hostName: hostname(),
        }),
        signal,
      },
    );
    if (response.status !== 201) throw new Error();
    enrolled = authSchema.parse(await response.json());
  } catch {
    throw new Error("Could not exchange machine enrollment credential");
  }
  if (enrolled.hostId !== bootstrap.hostId)
    throw new Error("Enrollment returned a different machine identity");
  await atomicWrite(
    join(dataDir, "auth.json"),
    `${JSON.stringify(enrolled)}\n`,
  );
  return { hostId: enrolled.hostId };
}
