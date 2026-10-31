import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compareResend,
  firstDifference,
  visibleText,
} from "../../../scripts/monthly-email/check-resend.mjs";
import { checkHosted } from "../../../scripts/monthly-email/hosted-map.mjs";
import {
  htmlSizeProblem,
  inboxLineProblems,
  issueIdentityProblems,
  LOGO,
  renderEmail,
} from "../../../scripts/monthly-email/render-email.mjs";

const spec = {
  month: "November 2026",
  ym: "2026_11",
  from: "bb <updates@mail.getbb.app>",
  reply_to: "support@terragonlabs.com",
  subject: "New in bb in November: one theme and another",
  preview: "Plus: a third theme.",
  opening: "You can now <do> things & more.",
  themes: [
    {
      title: "A theme",
      image: { src: "a.png", alt: "An image" },
      items: [
        {
          title: "Do a thing.",
          body: "Body with <code>x</code>.",
          versions: "0.49.0",
        },
      ],
      try: { label: "Try it in bb", prompt: "Do the thing" },
    },
  ],
  cta: {
    text: "Read the full release notes",
    download_prefix: "New to bb?",
    download_text: "Download it",
  },
  address: "1 Example St",
};

const fields = {
  from: spec.from,
  replyTo: spec.reply_to,
  subject: spec.subject,
  preview: spec.preview,
  name: "What's new in bb · November 2026",
};

const dirs = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "monthly-email-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("renderEmail", () => {
  const html = renderEmail(spec, { imagesBase: "https://cdn.test/" });

  it("escapes copy, tags links and hosts the logo with the graphics", () => {
    expect(html).toContain("You can now &lt;do&gt; things &amp; more.");
    expect(html).toContain("utm_campaign=monthly_releases_2026_11");
    expect(html).toContain("changelog?utm_source=bb&amp;utm_medium=email");
    expect(html).toContain('#0-49-0"');
    expect(html).toContain(`src="https://cdn.test/${LOGO}"`);
    expect(html).toContain('src="https://cdn.test/a.png"');
  });

  it("emits no preheader of its own", () => {
    expect(html).not.toContain("data-skip-in-text");
    expect(html).not.toContain("display:none");
  });
});

describe("spec checks", () => {
  it("rejects subjects and preview lines that inboxes cut off", () => {
    expect(inboxLineProblems(spec)).toEqual([]);
    const long = { ...spec, subject: "x".repeat(71), preview: "y".repeat(91) };
    expect(inboxLineProblems(long)).toHaveLength(2);
  });

  it("rejects HTML Gmail would clip and warns before that", () => {
    expect(htmlSizeProblem("x".repeat(59_000))).toBeNull();
    expect(htmlSizeProblem("x".repeat(61_000))?.fatal).toBe(false);
    expect(htmlSizeProblem("x".repeat(81_000))?.fatal).toBe(true);
  });

  it("catches a spec copied from another month", () => {
    expect(issueIdentityProblems(spec, "2026-11")).toEqual([]);
    expect(issueIdentityProblems(spec, "2026-12")).toHaveLength(2);
  });
});

describe("compareResend", () => {
  const hosted = { [LOGO]: "https://h/logo", "a.png": "https://h/a" };
  const ours = renderEmail(spec, { hosted });
  const resendPreheader =
    '<div data-skip-in-text="true" style="display:none">Plus: a third theme.<div> ‌​</div></div>';
  const theirs = ours
    .replace("<body", `${resendPreheader}<body`)
    .replace(
      "width:100%;max-width:560px;font-family",
      "max-width:592px;align:center;font-family",
    );

  it("passes a faithful build, ignoring Resend's preheader", () => {
    expect(visibleText(theirs)).toBe(visibleText(ours));
    const checks = compareResend(ours, theirs, spec, fields, hosted);
    expect(checks.filter(([, ok]) => !ok)).toEqual([]);
    expect(checks).toHaveLength(12);
  });

  it("fails and points at one changed phrase", () => {
    const edited = theirs.replace("Do a thing.", "Do another thing.");
    const failed = compareResend(ours, edited, spec, fields, hosted)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    expect(failed).toEqual(["visible text"]);
    expect(
      firstDifference(visibleText(ours), visibleText(edited))?.theirs,
    ).toContain("another");
  });

  it("fails when the spec changed after the send HTML was rendered", () => {
    const changed = { ...spec, opening: "Something new." };
    const failed = compareResend(ours, theirs, changed, fields, hosted)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    expect(failed).toEqual(["send HTML matches the spec"]);
  });
});

describe("hosted images", () => {
  it("keeps saved URLs it can't reach and drops ones that no longer match", async () => {
    const folder = tempDir();
    writeFileSync(join(folder, "a.png"), "new a");
    writeFileSync(join(folder, LOGO), "logo");
    writeFileSync(
      join(folder, "hosted.json"),
      JSON.stringify({ "a.png": "https://h/a", [LOGO]: "https://h/logo" }),
    );
    vi.stubGlobal("fetch", async (url) => {
      if (url === "https://h/logo") throw new Error("offline");
      return new Response("old a");
    });
    const { current, unreachable } = await checkHosted(folder);
    expect([...current.keys()]).toEqual([]);
    expect([...unreachable.keys()]).toEqual([LOGO]);
  });
});
