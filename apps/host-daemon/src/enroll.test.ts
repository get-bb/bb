import { expect, it, vi } from "vitest";
import { enrollDaemonHost } from "./enroll.js";

it("forwards arbitrary access headers on enrollment without a Cloud identity body", async () => {
  const fetchFn = vi.fn<typeof fetch>(async () => Response.json({hostId:"host-test",hostKey:"durable-key"},{status:201}));
  await enrollDaemonHost({fetchFn,hostId:"host-test",hostName:"test",serverUrl:"https://server.example",token:"bootstrap",serverHeaders:{"x-provider-token":"private"}});
  expect(fetchFn).toHaveBeenCalledWith("https://server.example/internal/hosts/enroll",expect.objectContaining({headers: {authorization:"Bearer bootstrap","content-type":"application/json","x-provider-token":"private"},body:JSON.stringify({hostId:"host-test",hostName:"test"})}));
});
