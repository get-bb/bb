import { describe, expect, it, vi } from "vitest";
import { allocationName, createVendor, type VendorFetch } from "./vendor.js";

const name = allocationName("key");
const droplet = { id: 42, name, tags: [name], status: "active" };
const signal = () => new AbortController().signal;
const response = (value: object, status = 200) =>
  new Response(JSON.stringify(value), { status });

describe("DigitalOcean REST adapter", () => {
  it("uses documented create fields and consumes the response despite caller cancellation", async () => {
    const controller = new AbortController();
    const request = vi.fn<VendorFetch>(async () => {
      controller.abort();
      return response({ droplet }, 202);
    });
    const api = createVendor("token-secret", request);
    await expect(
      api.create(
        {
          name,
          region: "nyc3",
          size: "s-2vcpu-4gb",
          userData: "cloud-init-secret",
        },
        controller.signal,
      ),
    ).resolves.toEqual(droplet);
    expect(request).toHaveBeenCalledWith(
      "https://api.digitalocean.com/v2/droplets",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          region: "nyc3",
          size: "s-2vcpu-4gb",
          image: "ubuntu-24-04-x64",
          tags: [name],
          user_data: "cloud-init-secret",
        }),
      }),
    );
    const requestSignal = request.mock.calls[0]?.[1]?.signal;
    expect(requestSignal?.aborted).toBe(false);
  });

  it("filters by tag and refuses duplicate allocation matches", async () => {
    const request = vi
      .fn<VendorFetch>()
      .mockResolvedValue(
        response({ droplets: [droplet, { ...droplet, id: 43 }] }),
      );
    await expect(
      createVendor("secret", request).find(name, signal()),
    ).rejects.toThrow("Multiple");
    expect(request.mock.calls[0]?.[0]).toBe(
      `https://api.digitalocean.com/v2/droplets?tag_name=${name}&per_page=2`,
    );
  });

  it("polls action completion and reports vendor action failure", async () => {
    const request = vi
      .fn<VendorFetch>()
      .mockResolvedValueOnce(
        response({ action: { id: 9, status: "in-progress" } }, 201),
      )
      .mockResolvedValueOnce(
        response({ action: { id: 9, status: "completed" } }),
      )
      .mockResolvedValueOnce(
        response({ droplet: { ...droplet, status: "off" } }),
      )
      .mockResolvedValueOnce(
        response({ action: { id: 10, status: "errored" } }, 201),
      );
    const api = createVendor("secret", request);
    const pending = api.power(42, "shutdown", signal());
    await pending;
    expect(request.mock.calls[1]?.[0]).toBe(
      "https://api.digitalocean.com/v2/droplets/42/actions/9",
    );
    await expect(api.power(42, "power_on", signal())).rejects.toThrow(
      "action failed",
    );
  });

  it.each([
    { type: "shutdown", stale: "active", desired: "off" },
    { type: "power_on", stale: "off", desired: "active" },
  ] as const)(
    "waits for $desired after the $type action completes",
    async ({ type, stale, desired }) => {
      const observed: string[] = [];
      const request = vi.fn<VendorFetch>(async (_url, options) => {
        if (options?.method === "POST")
          return response({ action: { id: 9, status: "completed" } });
        const status = observed.length === 0 ? stale : desired;
        observed.push(status);
        return response({ droplet: { ...droplet, status } });
      });
      await createVendor("secret", request).power(42, type, signal());
      expect(observed).toEqual([stale, desired]);
      expect(request.mock.calls.slice(1).map(([url]) => url)).toEqual([
        "https://api.digitalocean.com/v2/droplets/42",
        "https://api.digitalocean.com/v2/droplets/42",
      ]);
    },
  );

  it("cancels stale-state polling after action completion", async () => {
    const controller = new AbortController();
    const request = vi.fn<VendorFetch>(async (_url, options) => {
      if (options?.method === "POST")
        return response({ action: { id: 9, status: "completed" } });
      controller.abort();
      return response({ droplet });
    });
    await expect(
      createVendor("secret", request).power(42, "shutdown", controller.signal),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-progress power action before the next vendor poll", async () => {
    const controller = new AbortController();
    const request = vi.fn<VendorFetch>(async () => {
      controller.abort();
      return response({ action: { id: 9, status: "in-progress" } }, 201);
    });
    await expect(
      createVendor("secret", request).power(42, "shutdown", controller.signal),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not echo vendor bodies containing credentials and treats missing deletion as success", async () => {
    const request = vi
      .fn<VendorFetch>()
      .mockResolvedValueOnce(
        response({ message: "token-secret cloud-init-secret" }, 401),
      )
      .mockResolvedValueOnce(response({}, 404));
    const api = createVendor("token-secret", request);
    await expect(
      api.create(
        {
          name,
          region: "nyc3",
          size: "s-2vcpu-4gb",
          userData: "cloud-init-secret",
        },
        signal(),
      ),
    ).rejects.toThrow(/^DigitalOcean API returned HTTP 401\.$/);
    await expect(api.destroy(42, signal())).resolves.toBeUndefined();
  });
});

it("shares account inventory across concurrent hosts, expires after 30 seconds and invalidates every mutation", async () => {
  let time = 0;
  let status = "active";
  const request = vi.fn<VendorFetch>(async (url, options) => {
    const path = new URL(String(url)).pathname;
    if (options?.method === "DELETE")
      return new Response(null, { status: 204 });
    if (path.endsWith("/actions")) {
      const body = JSON.parse(String(options?.body));
      if (body.type === "shutdown") status = "off";
      if (body.type === "power_on") status = "active";
      return response({ action: { id: 1, status: "completed" } });
    }
    if (path === "/v2/sizes")
      return response({
        sizes: [{ slug: "small", price_hourly: 0.006, price_monthly: 4 }],
      });
    if (path === "/v2/snapshots") return response({ snapshots: [] });
    if (path === "/v2/reserved_ips") return response({ reserved_ips: [] });
    return response({
      droplet: {
        ...droplet,
        status,
        created_at: "2026-09-07T00:00:00Z",
        size_slug: "small",
      },
    });
  });
  const api = createVendor("secret", request, () => time);
  const read = () => api.inventory(42, signal());
  const count = (path: string) =>
    request.mock.calls.filter(([url]) => new URL(String(url)).pathname === path)
      .length;
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => api.inventory(42 + i, signal())),
  );
  for (const path of ["/v2/sizes", "/v2/snapshots", "/v2/reserved_ips"])
    expect(count(path)).toBe(1);
  await read();
  expect(count("/v2/sizes")).toBe(1);
  time = 30_001;
  await read();
  expect(count("/v2/sizes")).toBe(2);
  const mutations = [
    () => api.snapshot(42, "backup", signal()),
    () => api.deleteSnapshot("backup", signal()),
    () => api.power(42, "shutdown", signal()),
    () => api.destroy(42, signal()),
    () =>
      api.create(
        { name, region: "nyc3", size: "small", userData: "" },
        signal(),
      ),
  ];
  for (const [index, mutate] of mutations.entries()) {
    await mutate();
    await read();
    expect(count("/v2/sizes")).toBe(3 + index);
  }
  await createVendor("other-token", request, () => time).inventory(
    42,
    signal(),
  );
  expect(count("/v2/sizes")).toBe(8);
});
