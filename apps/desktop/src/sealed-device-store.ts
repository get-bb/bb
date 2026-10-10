import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hostname } from "node:os";
import {
  base64UrlDecode,
  base64UrlEncode,
  clientAuthMessage,
  deserializeSigningKeyPair,
  generateSigningKeyPair,
  keyFingerprint,
  serializeSigningKeyPair,
  sign,
  type SigningKeyPair,
} from "@bb/sealed-channel";
import {
  bbDesktopSealedTrustSchema,
  type BbDesktopSealedTrust,
} from "@bb/desktop-contract";
import { z } from "zod";

const IDENTITY_FILE_NAME = "sealed-device-identity.bin";
const TRUST_FILE_NAME = "sealed-trust.json";

export interface SealedDeviceEncryption {
  decryptString(encrypted: Buffer): string;
  encryptString(plainText: string): Buffer;
  isEncryptionAvailable(): boolean;
}

export interface SealedDeviceStoreFs {
  mkdir(
    path: string,
    options: { recursive: true },
  ): Promise<string | undefined>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer | string): Promise<void>;
}

const defaultFs: SealedDeviceStoreFs = { mkdir, readFile, writeFile };

const storedIdentitySchema = z
  .object({ publicKey: z.string().min(1), secretKey: z.string().min(1) })
  .strict();

const trustFileSchema = z.record(z.string(), bbDesktopSealedTrustSchema);

export interface SealedDeviceStore {
  identity(): Promise<SigningKeyPair>;
  publicKey(): Promise<string>;
  deviceName(): string;
  signClientAuth(transcriptBase64Url: string): Promise<string>;
  getTrust(origin: string): Promise<BbDesktopSealedTrust | null>;
  setTrust(origin: string, trust: BbDesktopSealedTrust | null): Promise<void>;
  fingerprint(): Promise<string>;
}

interface CreateSealedDeviceStoreArgs {
  encryption: SealedDeviceEncryption;
  fs?: SealedDeviceStoreFs;
  userDataPath: string;
  platform?: NodeJS.Platform;
  hostName?: string;
}

export function describeDesktopDevice(
  platform: NodeJS.Platform,
  host: string,
): string {
  const os =
    platform === "darwin"
      ? "Mac"
      : platform === "win32"
        ? "Windows PC"
        : "Linux";
  const trimmed = host.replace(/\.local$/u, "").trim();
  return trimmed.length > 0
    ? `bb desktop on ${trimmed} (${os})`
    : `bb desktop (${os})`;
}

export function createSealedDeviceStore(
  args: CreateSealedDeviceStoreArgs,
): SealedDeviceStore {
  const fsImpl = args.fs ?? defaultFs;
  const identityPath = join(args.userDataPath, IDENTITY_FILE_NAME);
  const trustPath = join(args.userDataPath, TRUST_FILE_NAME);
  const name = describeDesktopDevice(
    args.platform ?? process.platform,
    args.hostName ?? hostname(),
  );
  let cached: SigningKeyPair | null = null;
  let loading: Promise<SigningKeyPair> | null = null;

  async function readIdentity(): Promise<SigningKeyPair | null> {
    let encrypted: Buffer;
    try {
      encrypted = await fsImpl.readFile(identityPath);
    } catch (error) {
      if ((error as { code?: unknown }).code === "ENOENT") return null;
      throw new Error(
        `the desktop encryption key could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let plainText: string;
    try {
      plainText = args.encryption.decryptString(encrypted);
    } catch (error) {
      throw new Error(
        `the desktop encryption key could not be unlocked from the OS keychain: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const parsed = storedIdentitySchema.safeParse(JSON.parse(plainText));
    if (!parsed.success) {
      throw new Error(
        `the stored desktop encryption key is unreadable; delete ${identityPath} to enroll this app again`,
      );
    }
    return deserializeSigningKeyPair(parsed.data);
  }

  async function loadIdentity(): Promise<SigningKeyPair> {
    if (cached !== null) return cached;
    loading ??= (async () => {
      if (!args.encryption.isEncryptionAvailable()) {
        throw new Error(
          "no OS keychain is available to protect the desktop encryption key",
        );
      }
      const existing = await readIdentity();
      if (existing !== null) {
        cached = existing;
        return existing;
      }
      const pair = generateSigningKeyPair();
      await fsImpl.mkdir(dirname(identityPath), { recursive: true });
      await fsImpl.writeFile(
        identityPath,
        args.encryption.encryptString(
          JSON.stringify(serializeSigningKeyPair(pair)),
        ),
      );
      cached = pair;
      return pair;
    })().finally(() => {
      loading = null;
    });
    return loading;
  }

  interface TrustFile {
    records: Record<string, BbDesktopSealedTrust>;
  }

  async function readTrust(): Promise<TrustFile> {
    let text: string;
    try {
      text = (await fsImpl.readFile(trustPath)).toString("utf8");
    } catch (error) {
      if ((error as { code?: unknown }).code === "ENOENT") {
        return { records: {} };
      }
      throw new Error(
        `sealed trust file is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const parsed = trustFileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new Error(
        `sealed trust file is corrupt; delete ${trustPath} to pin servers again`,
      );
    }
    return { records: parsed.data };
  }

  async function writeTrust(file: TrustFile): Promise<void> {
    await fsImpl.mkdir(dirname(trustPath), { recursive: true });
    await fsImpl.writeFile(
      trustPath,
      `${JSON.stringify(file.records, null, 2)}\n`,
    );
  }

  return {
    identity: loadIdentity,
    async publicKey() {
      return base64UrlEncode((await loadIdentity()).publicKey);
    },
    deviceName: () => name,
    async signClientAuth(transcriptBase64Url) {
      const pair = await loadIdentity();
      const transcript = base64UrlDecode(transcriptBase64Url);
      if (transcript.length !== 32) {
        throw new Error("sealed client-auth transcript must be 32 bytes");
      }
      return base64UrlEncode(
        sign(clientAuthMessage(transcript, pair.publicKey), pair.secretKey),
      );
    },
    async getTrust(origin) {
      return (await readTrust()).records[origin] ?? null;
    },
    async setTrust(origin, trust) {
      const file = await readTrust();
      const existing = file.records[origin];
      if (trust === null) {
        delete file.records[origin];
      } else {
        file.records[origin] = {
          ...trust,
          verified:
            existing !== undefined && existing.serverKey === trust.serverKey
              ? existing.verified || trust.verified
              : false,
        };
      }
      await writeTrust(file);
    },
    async fingerprint() {
      return keyFingerprint((await loadIdentity()).publicKey);
    },
  };
}
