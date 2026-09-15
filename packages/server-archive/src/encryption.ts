import {
  type CipherGCM,
  createCipheriv,
  createDecipheriv,
  type DecipherGCM,
  hkdfSync,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { z } from "zod";
import { ServerArchiveError } from "./errors.js";

export type ServerArchiveEncryption =
  | { kind: "passphrase"; passphrase: string }
  | { kind: "key"; key: Buffer };

export type ServerArchiveEncryptionKind = "none" | "passphrase" | "key";

const MAGIC = Buffer.from("BBSA", "ascii");
const ENCRYPTED_FORMAT_VERSION = 1;
const FIXED_PREFIX_BYTES = MAGIC.length + 1 + 4;
const MAX_HEADER_BYTES = 16 * 1024;
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const CIPHER = "aes-256-gcm";
export const GCM_TAG_BYTES = 16;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const SCRYPT_COST = 2 ** 17;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const MAX_SCRYPT_COST = 2 ** 20;
const MAX_SCRYPT_BLOCK_SIZE = 32;
const MAX_SCRYPT_PARALLELIZATION = 16;
const MAX_SCRYPT_MEMORY_BYTES = 2 ** 30;
const ENCRYPTION_KEY_INFO = "bb-server-archive/v1/encryption";
const KEY_CHECK_INFO = "bb-server-archive/v1/key-check";

const base64Schema = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/u);

const encryptionHeaderSchema = z
  .object({
    cipher: z.literal(CIPHER),
    kdf: z.discriminatedUnion("name", [
      z
        .object({
          name: z.literal("scrypt"),
          N: z.number().int(),
          r: z.number().int(),
          p: z.number().int(),
          salt: base64Schema,
        })
        .strict(),
      z.object({ name: z.literal("raw") }).strict(),
    ]),
    iv: base64Schema,
    keyCheck: base64Schema,
  })
  .strict();
type EncryptionHeader = z.infer<typeof encryptionHeaderSchema>;
type ScryptKdf = Extract<EncryptionHeader["kdf"], { name: "scrypt" }>;

export type ArchivePrefix =
  | { kind: "none" }
  | { kind: "encrypted"; header: EncryptionHeader; bytes: Buffer };
type EncryptedArchivePrefix = Extract<ArchivePrefix, { kind: "encrypted" }>;

export function archivePrefixEncryptionKind(
  prefix: ArchivePrefix,
): ServerArchiveEncryptionKind {
  if (prefix.kind === "none") {
    return "none";
  }
  return prefix.header.kdf.name === "scrypt" ? "passphrase" : "key";
}

async function readAt(
  handle: FileHandle,
  position: number,
  length: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      length - offset,
      position + offset,
    );
    if (bytesRead === 0) {
      break;
    }
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

export async function readArchiveTag(
  handle: FileHandle,
  fileSize: number,
): Promise<Buffer> {
  const tag = await readAt(handle, fileSize - GCM_TAG_BYTES, GCM_TAG_BYTES);
  if (tag.length !== GCM_TAG_BYTES) {
    throw new ServerArchiveError("corrupt", "Archive is truncated");
  }
  return tag;
}

export async function readArchivePrefix(
  handle: FileHandle,
): Promise<ArchivePrefix> {
  const fixed = await readAt(handle, 0, FIXED_PREFIX_BYTES);
  if (fixed.length >= MAGIC.length && fixed.subarray(0, 4).equals(MAGIC)) {
    return readEncryptedPrefix(handle, fixed);
  }
  if (
    fixed.length >= GZIP_MAGIC.length &&
    fixed.subarray(0, GZIP_MAGIC.length).equals(GZIP_MAGIC)
  ) {
    return { kind: "none" };
  }
  throw new ServerArchiveError("corrupt", "File is not a bb server archive");
}

async function readEncryptedPrefix(
  handle: FileHandle,
  fixed: Buffer,
): Promise<EncryptedArchivePrefix> {
  if (fixed.length < FIXED_PREFIX_BYTES) {
    throw new ServerArchiveError("corrupt", "Archive header is truncated");
  }
  const version = fixed.readUInt8(MAGIC.length);
  if (version !== ENCRYPTED_FORMAT_VERSION) {
    throw new ServerArchiveError(
      "unsupported_version",
      `Unsupported encrypted bb server archive version ${String(version)}`,
    );
  }
  const headerLength = fixed.readUInt32BE(MAGIC.length + 1);
  if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) {
    throw new ServerArchiveError("corrupt", "Archive header is invalid");
  }
  const headerBytes = await readAt(handle, FIXED_PREFIX_BYTES, headerLength);
  if (headerBytes.length !== headerLength) {
    throw new ServerArchiveError("corrupt", "Archive header is truncated");
  }
  let headerJson: unknown;
  try {
    headerJson = JSON.parse(headerBytes.toString("utf8"));
  } catch {
    throw new ServerArchiveError("corrupt", "Archive header is invalid");
  }
  const parsed = encryptionHeaderSchema.safeParse(headerJson);
  if (!parsed.success) {
    throw new ServerArchiveError("corrupt", "Archive header is invalid");
  }
  return {
    kind: "encrypted",
    header: parsed.data,
    bytes: Buffer.concat([fixed, headerBytes]),
  };
}

function scryptMemoryBytes(kdf: Pick<ScryptKdf, "N" | "r" | "p">): number {
  return 128 * kdf.N * kdf.r * kdf.p;
}

function assertSupportedScryptParameters(kdf: ScryptKdf, salt: Buffer): void {
  const costIsPowerOfTwo = kdf.N > 1 && (kdf.N & (kdf.N - 1)) === 0;
  if (
    !costIsPowerOfTwo ||
    kdf.N > MAX_SCRYPT_COST ||
    kdf.r < 1 ||
    kdf.r > MAX_SCRYPT_BLOCK_SIZE ||
    kdf.p < 1 ||
    kdf.p > MAX_SCRYPT_PARALLELIZATION ||
    scryptMemoryBytes(kdf) > MAX_SCRYPT_MEMORY_BYTES ||
    salt.length < SALT_BYTES
  ) {
    throw new ServerArchiveError(
      "corrupt",
      "Archive key derivation parameters are invalid",
    );
  }
}

function deriveScryptKey(
  passphrase: string,
  salt: Buffer,
  kdf: Pick<ScryptKdf, "N" | "r" | "p">,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase.normalize("NFC"),
      salt,
      KEY_BYTES,
      { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 2 * scryptMemoryBytes(kdf) },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(key);
      },
    );
  });
}

function deriveArchiveKeys(
  masterKey: Buffer,
  iv: Buffer,
): { encryptionKey: Buffer; keyCheck: Buffer } {
  return {
    encryptionKey: Buffer.from(
      hkdfSync("sha256", masterKey, iv, ENCRYPTION_KEY_INFO, KEY_BYTES),
    ),
    keyCheck: Buffer.from(
      hkdfSync("sha256", masterKey, iv, KEY_CHECK_INFO, KEY_BYTES),
    ),
  };
}

export async function createArchiveEncryptor(
  encryption: ServerArchiveEncryption,
): Promise<{ prefix: Buffer; cipher: CipherGCM }> {
  const iv = randomBytes(IV_BYTES);
  let kdf: EncryptionHeader["kdf"];
  let masterKey: Buffer;
  if (encryption.kind === "passphrase") {
    if (encryption.passphrase.length === 0) {
      throw new Error("Archive passphrase must not be empty");
    }
    const salt = randomBytes(SALT_BYTES);
    const parameters = {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION,
    };
    masterKey = await deriveScryptKey(encryption.passphrase, salt, parameters);
    kdf = { name: "scrypt", ...parameters, salt: salt.toString("base64") };
  } else {
    if (encryption.key.length !== KEY_BYTES) {
      throw new Error(`Archive key must be ${String(KEY_BYTES)} bytes`);
    }
    masterKey = encryption.key;
    kdf = { name: "raw" };
  }
  const keys = deriveArchiveKeys(masterKey, iv);
  const header: EncryptionHeader = {
    cipher: CIPHER,
    kdf,
    iv: iv.toString("base64"),
    keyCheck: keys.keyCheck.toString("base64"),
  };
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const fixed = Buffer.alloc(FIXED_PREFIX_BYTES);
  MAGIC.copy(fixed, 0);
  fixed.writeUInt8(ENCRYPTED_FORMAT_VERSION, MAGIC.length);
  fixed.writeUInt32BE(headerBytes.length, MAGIC.length + 1);
  const prefix = Buffer.concat([fixed, headerBytes]);
  const cipher = createCipheriv(CIPHER, keys.encryptionKey, iv, {
    authTagLength: GCM_TAG_BYTES,
  });
  cipher.setAAD(prefix);
  return { prefix, cipher };
}

async function resolveMasterKey(
  header: EncryptionHeader,
  encryption: ServerArchiveEncryption | null,
): Promise<Buffer> {
  if (header.kdf.name === "scrypt") {
    if (encryption?.kind !== "passphrase") {
      throw new ServerArchiveError(
        "encryption_mismatch",
        "Archive is encrypted with a passphrase",
      );
    }
    const salt = Buffer.from(header.kdf.salt, "base64");
    assertSupportedScryptParameters(header.kdf, salt);
    return deriveScryptKey(encryption.passphrase, salt, header.kdf);
  }
  if (encryption?.kind !== "key") {
    throw new ServerArchiveError(
      "encryption_mismatch",
      "Archive is encrypted with a key",
    );
  }
  if (encryption.key.length !== KEY_BYTES) {
    throw new ServerArchiveError(
      "bad_passphrase",
      "Archive key does not match",
    );
  }
  return encryption.key;
}

export async function createArchiveDecryptor(
  prefix: EncryptedArchivePrefix,
  encryption: ServerArchiveEncryption | null,
): Promise<DecipherGCM> {
  const iv = Buffer.from(prefix.header.iv, "base64");
  const expectedKeyCheck = Buffer.from(prefix.header.keyCheck, "base64");
  if (iv.length !== IV_BYTES || expectedKeyCheck.length !== KEY_BYTES) {
    throw new ServerArchiveError("corrupt", "Archive header is invalid");
  }
  const masterKey = await resolveMasterKey(prefix.header, encryption);
  const keys = deriveArchiveKeys(masterKey, iv);
  if (!timingSafeEqual(keys.keyCheck, expectedKeyCheck)) {
    throw new ServerArchiveError(
      "bad_passphrase",
      prefix.header.kdf.name === "scrypt"
        ? "Archive passphrase is incorrect"
        : "Archive key does not match",
    );
  }
  const decipher = createDecipheriv(CIPHER, keys.encryptionKey, iv, {
    authTagLength: GCM_TAG_BYTES,
  });
  decipher.setAAD(prefix.bytes);
  return decipher;
}
