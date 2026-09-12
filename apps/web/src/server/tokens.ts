const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function generateToken(prefix: string): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}${out}`;
}

export function generateConnectCode(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (const b of buf) s += chars[b % chars.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
