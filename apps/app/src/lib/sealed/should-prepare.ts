const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);
const TRUST_KEY_PREFIX = "bb.sealed.trust:";

export function shouldPrepareSealedTransport(
  env: {
    location: { protocol: string; hostname: string; origin: string } | null;
    storage: Pick<Storage, "getItem"> | null;
  } = readEnvironment(),
): boolean {
  if (env.location === null) return false;
  if (env.location.protocol !== "http:" && env.location.protocol !== "https:")
    return false;
  if (env.storage?.getItem(`${TRUST_KEY_PREFIX}${env.location.origin}`))
    return true;
  if (LOOPBACK_HOSTS.has(env.location.hostname)) return false;
  return true;
}

function readEnvironment() {
  if (typeof window === "undefined") {
    return {
      location: null,
      storage: null,
      desktop: false,
      nativeShell: false,
    };
  }
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {}
  return {
    location: {
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      origin: window.location.origin,
    },
    storage,
  };
}
