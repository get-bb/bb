import { createReadCache } from "./inventory-cache.js";
import { snapshotSchema } from "./snapshot.js";
import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";

const dropletSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  tags: z.array(z.string()),
  status: z.enum(["new", "active", "off", "archive"]),
});
const inventoryDropletSchema = dropletSchema.extend({
  created_at: z.string().datetime(),
  size_slug: z.string(),
});
const sizeSchema = z.object({
  slug: z.string(),
  price_hourly: z.number().nonnegative(),
  price_monthly: z.number().nonnegative(),
});
const ipSchema = z.object({
  ip: z.string(),
  droplet: z.object({ id: z.number() }).nullable(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
const actionSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["in-progress", "completed", "errored"]),
});
export type Droplet = z.infer<typeof dropletSchema>;
export type VendorFetch = typeof fetch;

export function allocationName(key: string): string {
  return `bb-${createHash("sha256").update(key).digest("hex").slice(0, 48)}`;
}

export class VendorError extends Error {
  constructor(readonly status: number) {
    super(`DigitalOcean API returned HTTP ${status}.`);
  }
}

export function createVendor(
  token: string,
  requestFetch: VendorFetch = fetch,
  now: () => number = Date.now,
) {
  const ratesCache = createReadCache<z.infer<typeof sizeSchema>[]>(now);
  const snapshotsCache = createReadCache<Snapshot[]>(now);
  const ipsCache = createReadCache<z.infer<typeof ipSchema>[]>(now);
  function invalidate() {
    ratesCache.clear();
    snapshotsCache.clear();
    ipsCache.clear();
  }
  async function request(
    method: string,
    path: string,
    signal: AbortSignal,
    body?: object,
  ) {
    if (method !== "GET") invalidate();
    const response = await requestFetch(
      `https://api.digitalocean.com/v2${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    ).finally(() => {
      if (method !== "GET") invalidate();
    });
    if (response.status === 404 && (method === "GET" || method === "DELETE"))
      return null;
    if (!response.ok) throw new VendorError(response.status);
    if (response.status === 204) return null;
    const value: unknown = await response.json();
    return value;
  }

  async function action(
    id: number,
    body: { type: string; name?: string },
    signal: AbortSignal,
  ) {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(3_600_000)]);
    let current = z
      .object({ action: actionSchema })
      .parse(
        await request("POST", `/droplets/${id}/actions`, deadline, body),
      ).action;
    while (current.status === "in-progress") {
      await setTimeout(3000, undefined, { signal: deadline });
      current = z
        .object({ action: actionSchema })
        .parse(
          await request(
            "GET",
            `/droplets/${id}/actions/${current.id}`,
            deadline,
          ),
        ).action;
    }
    if (current.status !== "completed")
      throw new Error(`DigitalOcean ${body.type} action failed.`);
  }
  async function pages<T>(
    path: string,
    key: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<T[]> {
    const results: T[] = [];
    for (let page = 1; ; page++) {
      const value = z
        .record(z.string(), z.unknown())
        .parse(
          await request(
            "GET",
            `${path}${path.includes("?") ? "&" : "?"}per_page=200&page=${page}`,
            signal,
          ),
        );
      const items = z.array(schema).parse(value[key]);
      results.push(...items);
      const links = z
        .object({ pages: z.object({ next: z.string().optional() }).optional() })
        .optional()
        .parse(value.links);
      if (!links?.pages?.next) return results;
    }
  }
  function readSnapshots(signal: AbortSignal) {
    return snapshotsCache.get("account", signal, (shared) =>
      pages(
        "/snapshots?resource_type=droplet",
        "snapshots",
        snapshotSchema,
        shared,
      ),
    );
  }
  return {
    snapshots: readSnapshots,
    async snapshot(id: number, name: string, signal: AbortSignal) {
      try {
        await action(id, { type: "snapshot", name }, signal);
      } finally {
        invalidate();
      }
    },
    async deleteSnapshot(id: string, signal: AbortSignal) {
      await request("DELETE", `/snapshots/${encodeURIComponent(id)}`, signal);
    },
    async inventory(id: number, signal: AbortSignal) {
      const [raw, sizes, snapshots, reservedIps] = await Promise.all([
        request("GET", `/droplets/${id}`, signal),
        ratesCache.get("account", signal, (shared) =>
          pages("/sizes", "sizes", sizeSchema, shared),
        ),
        readSnapshots(signal),
        ipsCache.get("account", signal, (shared) =>
          pages("/reserved_ips", "reserved_ips", ipSchema, shared),
        ),
      ]);
      return {
        droplet:
          raw === null
            ? null
            : z.object({ droplet: inventoryDropletSchema }).parse(raw).droplet,
        sizes,
        snapshots,
        reservedIps,
      };
    },
    async find(name: string, signal: AbortSignal): Promise<Droplet | null> {
      const value = await request(
        "GET",
        `/droplets?tag_name=${encodeURIComponent(name)}&per_page=2`,
        signal,
      );
      const result = z
        .object({ droplets: z.array(dropletSchema) })
        .parse(value);
      if (result.droplets.length > 1)
        throw new Error(
          "Multiple DigitalOcean Droplets match the allocation key; reconcile them before retrying.",
        );
      const droplet = result.droplets[0];
      if (droplet === undefined) return null;
      if (droplet.name !== name || !droplet.tags.includes(name))
        throw new Error("DigitalOcean allocation ownership does not match.");
      return droplet;
    },
    async get(id: number, signal: AbortSignal): Promise<Droplet | null> {
      const result = await request("GET", `/droplets/${id}`, signal);
      return result === null
        ? null
        : z.object({ droplet: dropletSchema }).parse(result).droplet;
    },
    async create(
      input: { name: string; region: string; size: string; userData: string },
      signal: AbortSignal,
    ): Promise<Droplet> {
      signal.throwIfAborted();
      const result = await request(
        "POST",
        "/droplets",
        AbortSignal.timeout(30_000),
        {
          name: input.name,
          region: input.region,
          size: input.size,
          image: "ubuntu-24-04-x64",
          tags: [input.name],
          user_data: input.userData,
        },
      );
      return z.object({ droplet: dropletSchema }).parse(result).droplet;
    },
    async power(
      id: number,
      type: "shutdown" | "power_on",
      signal: AbortSignal,
    ): Promise<void> {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
      await action(id, { type }, deadline);
      const desiredStatus = type === "power_on" ? "active" : "off";
      while (true) {
        const value = await request("GET", `/droplets/${id}`, deadline);
        if (value === null)
          throw new Error(
            "DigitalOcean Droplet disappeared during power action.",
          );
        const { droplet } = z.object({ droplet: dropletSchema }).parse(value);
        if (droplet.status === desiredStatus) return;
        await setTimeout(3000, undefined, { signal: deadline });
      }
    },
    async destroy(id: number, signal: AbortSignal): Promise<void> {
      await request("DELETE", `/droplets/${id}`, signal);
    },
  };
}

export type Vendor = ReturnType<typeof createVendor>;
