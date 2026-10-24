import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { createServer } from "node:https";
import { promisify } from "node:util";
import { supervise } from "./process.js";
import { setTimeout as delay } from "node:timers/promises";
import { createRuntime } from "./runtime.js";
import { z } from "zod";

const binary = z.string().min(1).parse(process.env.DEV_BROWSER_SMOKE_BINARY);
const chrome = z.string().min(1).parse(process.env.DEV_BROWSER_SMOKE_CHROME);
const root = await mkdtemp(join(tmpdir(), "bb-dev-browser-smoke-"));
const dataDir = join(root, "data");
await mkdir(join(dataDir, "runtime"), { recursive: true });
const runtimeBinary = join(dataDir, "runtime", "dev-browser");
await copyFile(resolve(binary), runtimeBinary);
const version = z
  .string()
  .regex(/^dev-browser \S+$/)
  .parse(
    (await promisify(execFile)(runtimeBinary, ["--version"])).stdout.trim(),
  )
  .split(" ")[1]!;
await symlink(resolve(chrome), join(dataDir, "runtime", "chrome"));
function jpegWidth(base64: string): number {
  const bytes = Buffer.from(base64, "base64");
  let offset = 2;
  while (offset + 9 < bytes.length) {
    const marker = bytes[offset + 1]!;
    const isFrameHeader =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrameHeader) return bytes.readUInt16BE(offset + 7);
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error("JPEG frame header not found");
}
const attachedBrowsers: ReturnType<typeof supervise>[] = [];
const sessions: Awaited<ReturnType<typeof createRuntime>>[] = [];
try {
  const args = {
    runtime: {
      binary: runtimeBinary,
      version,
      source: "developer-artifact" as const,
    },
    dataDir,
    tempDir: join(root, "sessions"),
    signal: new AbortController().signal,
  };
  const a = await createRuntime(args);
  sessions.push(a);
  const b = await createRuntime(args);
  sessions.push(b);
  const url =
    "data:text/html," +
    encodeURIComponent(
      `<button id="b" onclick="this.textContent='clicked'">press</button>`,
    );
  const script = `const p = await browser.getPage("main"); await p.goto(${JSON.stringify(url)}); await p.click("#b"); await p.snapshot()`;
  const result = await a.run(script, 15_000, args.signal);
  assert.equal(result.exitCode, 0, result.text);
  assert.match(result.text, /clicked/);
  const screenshot = await a.run(
    'const p = await browser.getPage("main"); await p.shot({ type: "jpeg", maxEdge: 960, quality: 70 }); undefined',
    10_000,
    args.signal,
  );
  assert.equal(screenshot.images.length, 1);
  assert.deepEqual(
    (await readFile(screenshot.images[0]!.path)).subarray(0, 3),
    Buffer.from([0xff, 0xd8, 0xff]),
  );
  assert.ok(screenshot.images[0]!.width <= 960);
  assert.ok(a.preview);
  const firstFrame = await a.preview.next(0, 10_000, args.signal, "thumbnail");
  assert.ok(firstFrame);
  assert.deepEqual(
    Buffer.from(firstFrame.data, "base64").subarray(0, 3),
    Buffer.from([0xff, 0xd8, 0xff]),
  );
  assert.match(firstFrame.url, /^data:text\/html/);
  const pendingFrame = a.preview.next(
    firstFrame.sequence,
    10_000,
    args.signal,
    "thumbnail",
  );
  const secondPage = await a.run(
    'const p = await browser.getPage("second"); await p.goto("data:text/html,<title>Second</title><h1>second-page</h1>"); p.url()',
    10_000,
    args.signal,
  );
  assert.equal(secondPage.exitCode, 0, secondPage.text);
  let liveFrame = await pendingFrame;
  const followDeadline = AbortSignal.timeout(10_000);
  while (
    !liveFrame?.url.includes("second-page") ||
    liveFrame.title !== "Second"
  ) {
    followDeadline.throwIfAborted();
    liveFrame = await a.preview.next(
      liveFrame?.sequence ?? firstFrame.sequence,
      2_000,
      args.signal,
      "thumbnail",
    );
  }
  assert.ok(liveFrame.sequence > firstFrame.sequence);
  assert.ok(jpegWidth(liveFrame.data) <= 800);
  let fullFrame = liveFrame;
  const fullDeadline = AbortSignal.timeout(10_000);
  while (jpegWidth(fullFrame.data) <= 800) {
    fullDeadline.throwIfAborted();
    fullFrame =
      (await a.preview.next(fullFrame.sequence, 2_000, args.signal, "full")) ??
      fullFrame;
  }
  assert.ok(jpegWidth(fullFrame.data) <= 1280);
  assert.match(
    (await a.run("await browser.listPages()", 10_000, args.signal)).text,
    /second/,
  );
  const one = a.run(
    'const p = await browser.getPage("main"); await new Promise(r => setTimeout(r, 100)); await p.evaluate(() => { window.sequence = 1 }); "first"',
    10_000,
    args.signal,
  );
  const two = a.run(
    'const p = await browser.getPage("main"); await p.evaluate(() => window.sequence)',
    10_000,
    args.signal,
  );
  assert.equal((await one).exitCode, 0);
  assert.equal((await two).text.trim(), "1");
  const controller = new AbortController();
  const running = a.run(
    "await new Promise(() => {})",
    10_000,
    controller.signal,
  );
  const cancellation = assert.rejects(running);
  setTimeout(() => controller.abort(), 100);
  await cancellation;
  assert.equal(
    (
      await b.run(
        'const p = await browser.getPage("main"); await p.goto("data:text/html,still-alive"); p.url()',
        10_000,
        args.signal,
      )
    ).exitCode,
    0,
  );
  const timeout = b.run("while (true) {}", 1000, args.signal);
  await assert.rejects(timeout);
  const c = await createRuntime(args);
  sessions.push(c);
  assert.equal(
    (await c.run("await browser.listPages()", 10_000, args.signal)).exitCode,
    0,
  );
  await c.close();
  await assert.rejects(c.run("1", 1000, args.signal));
  const profile = join(root, "handed-off-profile");
  const attachedBrowser = supervise(
    resolve(chrome),
    [
      "--headless=new",
      "--no-sandbox",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "about:blank",
    ],
    process.env,
  );
  attachedBrowsers.push(attachedBrowser);
  let portFile = "";
  const deadline = AbortSignal.timeout(15_000);
  while (!portFile) {
    deadline.throwIfAborted();
    try {
      portFile = await readFile(join(profile, "DevToolsActivePort"), "utf8");
    } catch {
      await delay(25);
    }
  }
  const [port, path] = portFile.trim().split("\n");
  const connectionUrl = `ws://127.0.0.1:${port}${path}`;
  const attached = await createRuntime({ ...args, connectionUrl });
  sessions.push(attached);
  assert.equal(attached.preview, null);
  assert.equal(
    (
      await attached.run(
        'const p = await browser.getPage("main"); await p.goto("data:text/html,handoff-preserved"); p.url()',
        10_000,
        args.signal,
      )
    ).exitCode,
    0,
  );
  await attached.close();
  assert.equal(attachedBrowser.alive(), true);
  const reattached = await createRuntime({ ...args, connectionUrl });
  sessions.push(reattached);
  assert.match(
    (await reattached.run("await browser.listPages()", 10_000, args.signal))
      .text,
    /handoff-preserved/,
  );
  const plantedSecret = "smoke-planted-Secret-7f3a9c";
  await promisify(execFile)("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-keyout",
    join(root, "key.pem"),
    "-out",
    join(root, "cert.pem"),
  ]);
  const posted: string[] = [];
  const login = createServer(
    {
      key: await readFile(join(root, "key.pem")),
      cert: await readFile(join(root, "cert.pem")),
    },
    (request, response) => {
      if (request.method === "POST") {
        let body = "";
        request.on("data", (chunk: Buffer) => (body += chunk.toString()));
        request.on("end", () => {
          posted.push(new URLSearchParams(body).get("password") ?? "");
          response.end("<title>Signed in</title>signed-in");
        });
        return;
      }
      response.setHeader("content-type", "text/html");
      response.end(
        `<title>Login</title><form method="post"><input id="password" name="password" type="password"><input id="otp" name="otp"><button id="go">Sign in</button></form>`,
      );
    },
  );
  await new Promise<void>((resolve) => login.listen(0, "127.0.0.1", resolve));
  const loginPort = z.object({ port: z.number() }).parse(login.address()).port;
  const loginOrigin = `https://localhost:${loginPort}`;
  try {
    const tlsProfile = join(root, "tls-profile");
    const tlsBrowser = supervise(
      resolve(chrome),
      [
        "--headless=new",
        "--no-sandbox",
        "--ignore-certificate-errors",
        "--remote-debugging-port=0",
        `--user-data-dir=${tlsProfile}`,
        "--no-first-run",
        "about:blank",
      ],
      process.env,
    );
    attachedBrowsers.push(tlsBrowser);
    let tlsPortFile = "";
    const tlsDeadline = AbortSignal.timeout(15_000);
    while (!tlsPortFile) {
      tlsDeadline.throwIfAborted();
      try {
        tlsPortFile = await readFile(
          join(tlsProfile, "DevToolsActivePort"),
          "utf8",
        );
      } catch {
        await delay(25);
      }
    }
    const [tlsPort, tlsPath] = tlsPortFile.trim().split("\n");
    const tls = await createRuntime({
      ...args,
      connectionUrl: `ws://127.0.0.1:${tlsPort}${tlsPath}`,
    });
    sessions.push(tls);
    assert.equal(
      (
        await tls.run(
          `const p = await browser.getPage("main"); await p.goto(${JSON.stringify(`${loginOrigin}/login`)}); p.url()`,
          10_000,
          args.signal,
        )
      ).exitCode,
      0,
    );
    const fill = (expectedOrigin: string, selector = "#password") =>
      tls.fill(
        { page: "main", selector, value: plantedSecret, expectedOrigin },
        args.signal,
      );
    assert.equal(await fill("https://example.com"), "origin_mismatch");
    assert.equal(await fill(loginOrigin, "#missing"), "element_not_found");
    assert.equal(
      await tls.fill(
        {
          page: "absent",
          selector: "#password",
          value: plantedSecret,
          expectedOrigin: loginOrigin,
        },
        args.signal,
      ),
      "page_not_found",
    );
    assert.equal(await fill(loginOrigin), "ok");
    assert.equal(await fill(loginOrigin, "#otp"), "ok");
    const reads = await tls.run(
      'const p = await browser.getPage("main"); const values = await p.evaluate(() => [document.querySelector("#password").value, document.querySelector("#otp").value, getComputedStyle(document.querySelector("#otp")).webkitTextSecurity]); console.log(JSON.stringify(values)); await p.snapshot()',
      10_000,
      args.signal,
    );
    assert.equal(reads.exitCode, 0, reads.text);
    assert.ok(!reads.text.includes(plantedSecret));
    assert.match(reads.text, /\[filled value\]/);
    assert.match(reads.text, /disc/);
    if (process.platform === "linux") {
      for (const pid of await readdir("/proc")) {
        if (!/^\d+$/.test(pid)) continue;
        for (const file of ["cmdline", "environ"]) {
          const content = await readFile(join("/proc", pid, file)).catch(
            () => null,
          );
          assert.ok(
            !content?.includes(plantedSecret),
            `planted secret found in /proc/${pid}/${file}`,
          );
        }
      }
    }
    await tls.run(
      'const p = await browser.getPage("main"); await p.click("#go"); await p.waitForLoad(); p.url()',
      10_000,
      args.signal,
    );
    assert.deepEqual(posted, [plantedSecret]);
    await tls.close();
  } finally {
    login.close();
  }
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "headless navigation and click",
        "readable temporary JPEG",
        "live preview follows the active page while scripts run",
        "live preview switches to full-size frames on request",
        "attached sessions expose no preview",
        "serialized scripts",
        "cancellation isolation",
        "infinite-loop timeout",
        "reopen after timeout",
        "close rejects further work",
        "attachment close preserves browser and page state",
        "private fill types into an HTTPS page, refuses other sites, and masks the value",
      ],
    }),
  );
} finally {
  await Promise.all(sessions.map((session) => session.close()));
  await Promise.all(attachedBrowsers.map((browser) => browser.close()));
  await rm(root, { recursive: true, force: true });
}
