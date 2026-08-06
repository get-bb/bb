import { KeyObject } from "node:crypto";
import {
  WORK_TOGETHER_PRINCIPAL_CLAIM_KEYS,
  WORK_TOGETHER_PRINCIPAL_CLOCK_SKEW_SECONDS,
  WORK_TOGETHER_PRINCIPAL_JWT_ALG,
  WORK_TOGETHER_PRINCIPAL_JWT_TYP,
  WORK_TOGETHER_PRINCIPAL_MAX_LIFETIME_SECONDS,
  type WorkTogetherPrincipalClaims,
  canonicalizeInternalRequestTarget,
} from "@bb/server-contract";
import { compactVerify } from "jose";
import {
  getNodeValue,
  parseTree,
  type Node,
  type ParseError,
} from "jsonc-parser";
import {
  isCanonicalMembershipRevision,
  WORK_TOGETHER_CELL_ID_PATTERN,
  WORK_TOGETHER_SUBJECT_PATTERN,
} from "./work-together-membership.js";
import { rejectWorkTogetherPrincipalAssertion } from "./work-together-principal-assertion-error.js";

const MAX_TOKEN_LENGTH = 8192;
const MAX_HEADER_UTF8_BYTES = 1024;
const MAX_PAYLOAD_UTF8_BYTES = 4096;
const MAX_ISSUER_LENGTH = 256;
const MAX_DISPLAY_NAME_CODE_POINTS = 100;
const MAX_DISPLAY_NAME_UTF8_BYTES = 400;
const KID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const CANONICAL_NONNEGATIVE_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/u;
const REQUEST_METHOD_PATTERN = /^[A-Z]{1,16}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

const PROTECTED_HEADER_KEYS = ["alg", "kid", "typ"] as const;
const CLAIM_KEY_SET = new Set<string>(WORK_TOGETHER_PRINCIPAL_CLAIM_KEYS);

export type WorkTogetherPrincipalVerificationKey = CryptoKey | KeyObject;

export type WorkTogetherPrincipalVerifierConfig = {
  readonly issuer: string;
  readonly cellId: string;
  readonly workspaceId: string;
  readonly verificationKeys: ReadonlyMap<
    string,
    WorkTogetherPrincipalVerificationKey
  >;
  readonly now: () => number;
};

export type WorkTogetherPrincipalVerifiedAssertion = {
  readonly claims: WorkTogetherPrincipalClaims;
};

type ProtectedHeader = {
  readonly alg: typeof WORK_TOGETHER_PRINCIPAL_JWT_ALG;
  readonly kid: string;
  readonly typ: typeof WORK_TOGETHER_PRINCIPAL_JWT_TYP;
};

/**
 * Copy and validate a pinned Ed25519 verification-key map (1..2 kids).
 * Rejects symmetric/RSA/other keys and private material.
 */
export function copyPinnedVerificationKeys(
  input:
    | ReadonlyMap<string, WorkTogetherPrincipalVerificationKey>
    | Readonly<Record<string, WorkTogetherPrincipalVerificationKey>>,
): ReadonlyMap<string, WorkTogetherPrincipalVerificationKey> {
  const entries =
    input instanceof Map
      ? [...input.entries()]
      : Object.entries(
          input as Record<string, WorkTogetherPrincipalVerificationKey>,
        );

  if (entries.length < 1 || entries.length > 2) {
    rejectWorkTogetherPrincipalAssertion();
  }

  const copied = new Map<string, WorkTogetherPrincipalVerificationKey>();
  for (const [kid, key] of entries) {
    if (typeof kid !== "string" || !KID_PATTERN.test(kid)) {
      rejectWorkTogetherPrincipalAssertion();
    }
    if (copied.has(kid)) {
      rejectWorkTogetherPrincipalAssertion();
    }
    assertEd25519VerificationKey(key);
    copied.set(kid, key);
  }
  return copied;
}

export function assertWorkTogetherPrincipalVerifierConfig(config: {
  issuer: unknown;
  cellId: unknown;
  workspaceId: unknown;
  now: unknown;
}): asserts config is {
  issuer: string;
  cellId: string;
  workspaceId: string;
  now: () => number;
} {
  if (
    typeof config.issuer !== "string" ||
    config.issuer.length < 1 ||
    config.issuer.length > MAX_ISSUER_LENGTH
  ) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (
    typeof config.cellId !== "string" ||
    !WORK_TOGETHER_CELL_ID_PATTERN.test(config.cellId)
  ) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (
    typeof config.workspaceId !== "string" ||
    !WORK_TOGETHER_CELL_ID_PATTERN.test(config.workspaceId)
  ) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (typeof config.now !== "function") {
    rejectWorkTogetherPrincipalAssertion();
  }
}

/**
 * Strict compact-JWS verification for Work Together Principal assertions.
 * Uses jose.compactVerify only; never implements crypto or remote key lookup.
 */
export async function verifyWorkTogetherPrincipalAssertion(args: {
  readonly token: string;
  readonly config: WorkTogetherPrincipalVerifierConfig;
  readonly actualMethod: string;
  readonly actualTarget: string;
  readonly actualTransport: "http" | "websocket";
}): Promise<WorkTogetherPrincipalVerifiedAssertion> {
  const { token, config, actualMethod, actualTarget, actualTransport } = args;

  if (
    typeof token !== "string" ||
    token.length < 1 ||
    token.length > MAX_TOKEN_LENGTH
  ) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (token.includes(",")) {
    rejectWorkTogetherPrincipalAssertion();
  }

  const segments = token.split(".");
  if (segments.length !== 3) {
    rejectWorkTogetherPrincipalAssertion();
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (
    headerSegment === undefined ||
    payloadSegment === undefined ||
    signatureSegment === undefined ||
    headerSegment.length === 0 ||
    payloadSegment.length === 0 ||
    signatureSegment.length === 0
  ) {
    rejectWorkTogetherPrincipalAssertion();
  }

  const headerBytes = decodeCanonicalBase64Url(headerSegment);
  const payloadBytes = decodeCanonicalBase64Url(payloadSegment);
  decodeCanonicalBase64Url(signatureSegment);

  if (headerBytes.byteLength > MAX_HEADER_UTF8_BYTES) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (payloadBytes.byteLength > MAX_PAYLOAD_UTF8_BYTES) {
    rejectWorkTogetherPrincipalAssertion();
  }

  const headerText = decodeUtf8Fatal(headerBytes);
  const payloadText = decodeUtf8Fatal(payloadBytes);

  const headerTree = parseStrictObjectTree(headerText);
  assertNoDuplicatePropertyNames(headerTree);
  const protectedHeader = readProtectedHeader(headerTree, headerText);

  const key = config.verificationKeys.get(protectedHeader.kid);
  if (key === undefined) {
    rejectWorkTogetherPrincipalAssertion();
  }

  const payloadTree = parseStrictObjectTree(payloadText);
  assertNoDuplicatePropertyNames(payloadTree);
  const rawClaims = readRawClaims(payloadTree, payloadText);

  try {
    await compactVerify(token, key, {
      algorithms: [WORK_TOGETHER_PRINCIPAL_JWT_ALG],
    });
  } catch {
    rejectWorkTogetherPrincipalAssertion();
  }

  const claims = validateClaimsAgainstRequest({
    rawClaims,
    config,
    actualMethod,
    actualTarget,
    actualTransport,
  });

  return {
    claims: Object.freeze({ ...claims }),
  };
}

function assertEd25519VerificationKey(
  key: unknown,
): asserts key is WorkTogetherPrincipalVerificationKey {
  if (key instanceof KeyObject) {
    if (key.type === "public" && key.asymmetricKeyType === "ed25519") {
      return;
    }
    rejectWorkTogetherPrincipalAssertion();
  }
  if (typeof CryptoKey !== "undefined" && key instanceof CryptoKey) {
    if (
      key.type === "public" &&
      key.algorithm.name === "Ed25519" &&
      key.usages.includes("verify")
    ) {
      return;
    }
    rejectWorkTogetherPrincipalAssertion();
  }
  rejectWorkTogetherPrincipalAssertion();
}

function decodeCanonicalBase64Url(segment: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(segment)) {
    rejectWorkTogetherPrincipalAssertion();
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(segment, "base64url");
  } catch {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (bytes.toString("base64url") !== segment) {
    rejectWorkTogetherPrincipalAssertion();
  }
  return new Uint8Array(bytes);
}

function decodeUtf8Fatal(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    rejectWorkTogetherPrincipalAssertion();
  }
}

function parseStrictObjectTree(text: string): Node {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, {
    disallowComments: true,
    allowTrailingComma: false,
    allowEmptyContent: false,
  });
  if (
    errors.length > 0 ||
    tree === undefined ||
    tree.type !== "object" ||
    tree.offset !== 0 ||
    tree.length !== text.length
  ) {
    rejectWorkTogetherPrincipalAssertion();
  }
  return tree;
}

function assertNoDuplicatePropertyNames(node: Node): void {
  if (node.type === "object") {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      if (
        property.type !== "property" ||
        property.children === undefined ||
        property.children.length < 2
      ) {
        rejectWorkTogetherPrincipalAssertion();
      }
      const nameNode = property.children[0]!;
      if (nameNode.type !== "string" || typeof nameNode.value !== "string") {
        rejectWorkTogetherPrincipalAssertion();
      }
      if (seen.has(nameNode.value)) {
        rejectWorkTogetherPrincipalAssertion();
      }
      seen.add(nameNode.value);
      assertNoDuplicatePropertyNames(property.children[1]!);
    }
    return;
  }
  if (node.type === "array") {
    for (const child of node.children ?? []) {
      assertNoDuplicatePropertyNames(child);
    }
  }
}

function readProtectedHeader(tree: Node, source: string): ProtectedHeader {
  const properties = objectProperties(tree);
  if (properties.length !== PROTECTED_HEADER_KEYS.length) {
    rejectWorkTogetherPrincipalAssertion();
  }

  const values = new Map<string, string>();
  for (const { name, valueNode } of properties) {
    if (name !== "alg" && name !== "kid" && name !== "typ") {
      rejectWorkTogetherPrincipalAssertion();
    }
    if (valueNode.type !== "string") {
      rejectWorkTogetherPrincipalAssertion();
    }
    const value = getNodeValue(valueNode);
    if (typeof value !== "string") {
      rejectWorkTogetherPrincipalAssertion();
    }
    // Ensure the AST source is a JSON string (not a non-string coerced value).
    const lexical = source.slice(
      valueNode.offset,
      valueNode.offset + valueNode.length,
    );
    if (!lexical.startsWith('"') || !lexical.endsWith('"')) {
      rejectWorkTogetherPrincipalAssertion();
    }
    values.set(name, value);
  }

  for (const key of PROTECTED_HEADER_KEYS) {
    if (!values.has(key)) {
      rejectWorkTogetherPrincipalAssertion();
    }
  }

  const alg = values.get("alg")!;
  const kid = values.get("kid")!;
  const typ = values.get("typ")!;
  if (alg !== WORK_TOGETHER_PRINCIPAL_JWT_ALG) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (typ !== WORK_TOGETHER_PRINCIPAL_JWT_TYP) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (!KID_PATTERN.test(kid)) {
    rejectWorkTogetherPrincipalAssertion();
  }

  return {
    alg: WORK_TOGETHER_PRINCIPAL_JWT_ALG,
    kid,
    typ: WORK_TOGETHER_PRINCIPAL_JWT_TYP,
  };
}

type RawClaims = {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly jti: string;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  readonly workspace_id: string;
  readonly membership_revision: string;
  readonly principal_kind: string;
  readonly display_name: string;
  readonly request_method: string;
  readonly request_target: string;
  readonly transport: string;
};

function readRawClaims(tree: Node, source: string): RawClaims {
  const properties = objectProperties(tree);
  if (properties.length !== WORK_TOGETHER_PRINCIPAL_CLAIM_KEYS.length) {
    rejectWorkTogetherPrincipalAssertion();
  }

  const seen = new Set<string>();
  const values: Record<string, unknown> = {};

  for (const { name, valueNode } of properties) {
    if (!CLAIM_KEY_SET.has(name) || seen.has(name)) {
      rejectWorkTogetherPrincipalAssertion();
    }
    seen.add(name);

    if (name === "iat" || name === "nbf" || name === "exp") {
      values[name] = readCanonicalSafeInteger(valueNode, source);
      continue;
    }

    if (valueNode.type !== "string") {
      rejectWorkTogetherPrincipalAssertion();
    }
    const value = getNodeValue(valueNode);
    if (typeof value !== "string") {
      rejectWorkTogetherPrincipalAssertion();
    }
    values[name] = value;
  }

  for (const key of WORK_TOGETHER_PRINCIPAL_CLAIM_KEYS) {
    if (!seen.has(key)) {
      rejectWorkTogetherPrincipalAssertion();
    }
  }

  return values as RawClaims;
}

function readCanonicalSafeInteger(valueNode: Node, source: string): number {
  if (valueNode.type !== "number") {
    rejectWorkTogetherPrincipalAssertion();
  }
  const lexical = source.slice(
    valueNode.offset,
    valueNode.offset + valueNode.length,
  );
  if (!CANONICAL_NONNEGATIVE_INTEGER_PATTERN.test(lexical)) {
    rejectWorkTogetherPrincipalAssertion();
  }
  const value = getNodeValue(valueNode);
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value !== Number(lexical)
  ) {
    rejectWorkTogetherPrincipalAssertion();
  }
  return value;
}

function objectProperties(
  tree: Node,
): ReadonlyArray<{ readonly name: string; readonly valueNode: Node }> {
  const out: Array<{ name: string; valueNode: Node }> = [];
  for (const property of tree.children ?? []) {
    if (
      property.type !== "property" ||
      property.children === undefined ||
      property.children.length < 2
    ) {
      rejectWorkTogetherPrincipalAssertion();
    }
    const nameNode = property.children[0]!;
    const valueNode = property.children[1]!;
    if (nameNode.type !== "string" || typeof nameNode.value !== "string") {
      rejectWorkTogetherPrincipalAssertion();
    }
    out.push({ name: nameNode.value, valueNode });
  }
  return out;
}

function validateClaimsAgainstRequest(args: {
  rawClaims: RawClaims;
  config: WorkTogetherPrincipalVerifierConfig;
  actualMethod: string;
  actualTarget: string;
  actualTransport: "http" | "websocket";
}): WorkTogetherPrincipalClaims {
  const { rawClaims, config, actualMethod, actualTarget, actualTransport } =
    args;

  const nowMs = readSafeNonnegativeIntegerClock(config.now);
  const nowSec = Math.floor(nowMs / 1000);

  if (rawClaims.iss !== config.issuer) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (rawClaims.aud !== config.cellId) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (rawClaims.workspace_id !== config.workspaceId) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (!WORK_TOGETHER_SUBJECT_PATTERN.test(rawClaims.sub)) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (!CANONICAL_UUID_PATTERN.test(rawClaims.jti)) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (rawClaims.principal_kind !== "human") {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (!isCanonicalMembershipRevision(rawClaims.membership_revision)) {
    rejectWorkTogetherPrincipalAssertion();
  }
  assertValidDisplayName(rawClaims.display_name);

  if (!REQUEST_METHOD_PATTERN.test(rawClaims.request_method)) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (!REQUEST_METHOD_PATTERN.test(actualMethod)) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (rawClaims.request_method !== actualMethod) {
    rejectWorkTogetherPrincipalAssertion();
  }

  let canonicalTarget: string;
  try {
    canonicalTarget = canonicalizeInternalRequestTarget(actualTarget);
  } catch {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (rawClaims.request_target !== canonicalTarget) {
    rejectWorkTogetherPrincipalAssertion();
  }

  if (rawClaims.transport !== "http" && rawClaims.transport !== "websocket") {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (rawClaims.transport !== actualTransport) {
    rejectWorkTogetherPrincipalAssertion();
  }

  const { iat, nbf, exp } = rawClaims;
  if (nbf !== iat) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (!(exp > iat)) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (exp - iat > WORK_TOGETHER_PRINCIPAL_MAX_LIFETIME_SECONDS) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (iat > nowSec + WORK_TOGETHER_PRINCIPAL_CLOCK_SKEW_SECONDS) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (nbf > nowSec + WORK_TOGETHER_PRINCIPAL_CLOCK_SKEW_SECONDS) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (exp <= nowSec - WORK_TOGETHER_PRINCIPAL_CLOCK_SKEW_SECONDS) {
    rejectWorkTogetherPrincipalAssertion();
  }

  return {
    iss: rawClaims.iss,
    aud: rawClaims.aud,
    sub: rawClaims.sub,
    jti: rawClaims.jti,
    iat,
    nbf,
    exp,
    workspace_id: rawClaims.workspace_id,
    membership_revision: rawClaims.membership_revision,
    principal_kind: "human",
    display_name: rawClaims.display_name,
    request_method: rawClaims.request_method,
    request_target: rawClaims.request_target,
    transport: rawClaims.transport,
  };
}

function assertValidDisplayName(value: string): void {
  if (typeof value !== "string") {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (value !== value.trim() || value.normalize("NFC") !== value) {
    rejectWorkTogetherPrincipalAssertion();
  }
  const codePoints = [...value];
  if (
    codePoints.length < 1 ||
    codePoints.length > MAX_DISPLAY_NAME_CODE_POINTS
  ) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (Buffer.byteLength(value, "utf8") > MAX_DISPLAY_NAME_UTF8_BYTES) {
    rejectWorkTogetherPrincipalAssertion();
  }
  for (const codePoint of codePoints) {
    const code = codePoint.codePointAt(0)!;
    if (code <= 0x1f || code === 0x7f || (code >= 0xd800 && code <= 0xdfff)) {
      rejectWorkTogetherPrincipalAssertion();
    }
  }
}

function readSafeNonnegativeIntegerClock(now: () => number): number {
  let value: number;
  try {
    value = now();
  } catch {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    rejectWorkTogetherPrincipalAssertion();
  }
  return value;
}

export function readSafeNonnegativeIntegerNow(now: () => number): number {
  return readSafeNonnegativeIntegerClock(now);
}
