import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";

const dropletSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  tags: z.array(z.string()),
  status: z.enum(["new", "active", "off", "archive"]),
});
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

export function createVendor(token: string, requestFetch: VendorFetch = fetch) {
  async function request(
    method: string,
    path: string,
    signal: AbortSignal,
    body?: object,
  ) {
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
    );
    if (response.status === 404 && (method === "GET" || method === "DELETE"))
      return null;
    if (!response.ok) throw new VendorError(response.status);
    if (response.status === 204) return null;
    const value: unknown = await response.json();
    return value;
  }

  return {
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
      type: "power_off" | "power_on",
      signal: AbortSignal,
    ): Promise<void> {
      const result = z
        .object({ action: actionSchema })
        .parse(
          await request("POST", `/droplets/${id}/actions`, signal, { type }),
        );
      let action = result.action;
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
      while (action.status === "in-progress") {
        await setTimeout(3000, undefined, { signal: deadline });
        action = z
          .object({ action: actionSchema })
          .parse(
            await request(
              "GET",
              `/droplets/${id}/actions/${action.id}`,
              deadline,
            ),
          ).action;
      }
      if (action.status !== "completed")
        throw new Error(`DigitalOcean ${type} action failed.`);
    },
    async destroy(id: number, signal: AbortSignal): Promise<void> {
      await request("DELETE", `/droplets/${id}`, signal);
    },
  };
}

export type Vendor = ReturnType<typeof createVendor>;
