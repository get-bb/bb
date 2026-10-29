import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  COMMUNITY_MAX,
  questionVisible,
  surveyQuestions,
  type FormValues,
} from "./survey";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
export const SURVEY_EMAIL_FROM = "bb <updates@mail.getbb.app>";
export const SURVEY_EMAIL_SUBJECT = "Your bb survey answers";
export const SURVEY_EMAIL_MARK =
  "https://getbb.app/brand/bb-logo-flat-black.png";

export function surveyEmailAnswers(
  answers: FormValues,
): { label: string; answer: string }[] {
  return surveyQuestions.flatMap((question) => {
    const selected = answers[question.name];
    if (!selected?.length) return [];
    const other = answers[`${question.name}_other`]?.[0];
    const shown = selected.map((value) =>
      value === "Other" && other ? `Other: ${other}` : value,
    );
    return [{ label: question.label, answer: shown.join(", ") }];
  });
}

const INK = "#393939";
const HEADING = "#2f2f2f";
const DIM = "#5b5b5b";
const BORDER = "#e3e3e3";
const SELECTED = "#f3f3f3";
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SECTIONS: Record<string, string> = {
  discovery: "Getting to know you",
  love: "Your experience with bb",
  community: "What you'd like from the bb community",
};

function label(name: string, text: string, answers: FormValues): string {
  if (name === "meetup") {
    const city = answers.city?.[0]?.trim();
    return `Would you come to a bb meetup ${city ? `in ${city}` : "near you"}?`;
  }
  if (name === "community") return `${text} (pick up to ${COMMUNITY_MAX})`;
  return text;
}

function option(text: string, checked: boolean, multiple: boolean) {
  return h(
    "td",
    {
      width: "50%",
      valign: "top",
      style: {
        border: `1px solid ${checked ? DIM : BORDER}`,
        borderRadius: "8px",
        background: checked ? SELECTED : "#ffffff",
        padding: "11px 14px",
        fontSize: "14px",
        lineHeight: "1.45",
        color: INK,
      },
    },
    h(
      "span",
      { style: { color: checked ? HEADING : "#9a9a9a", marginRight: "9px" } },
      multiple ? (checked ? "☑" : "☐") : checked ? "◉" : "○",
    ),
    text,
  );
}

function options(
  question: (typeof surveyQuestions)[number],
  answers: FormValues,
) {
  const selected = answers[question.name] ?? [];
  const other = answers[`${question.name}_other`]?.[0];
  const cells = question.options.map((value) =>
    option(
      value === "Other" && other && selected.includes("Other")
        ? `Other: ${other}`
        : value,
      selected.includes(value),
      question.type === "checkbox",
    ),
  );
  const rows = [];
  for (let index = 0; index < cells.length; index += 2) {
    rows.push(
      h(
        "tr",
        { key: index },
        cells[index],
        h(
          "td",
          {
            width: "12",
            style: {
              width: "12px",
              minWidth: "12px",
              fontSize: "1px",
              lineHeight: "1px",
            },
          },
          "\u00a0",
        ),
        cells[index + 1] ?? h("td", { width: "50%" }),
      ),
    );
  }
  return h(
    "table",
    {
      role: "presentation",
      width: "100%",
      cellPadding: 0,
      cellSpacing: 0,
      style: { borderCollapse: "separate", borderSpacing: "0 8px" },
    },
    h("tbody", null, ...rows),
  );
}

function textAnswer(value: string) {
  return h(
    "div",
    {
      style: {
        border: `1px solid ${BORDER}`,
        borderRadius: "8px",
        padding: "13px 15px",
        fontSize: "16px",
        lineHeight: "1.5",
        color: INK,
        whiteSpace: "pre-wrap",
      },
    },
    value,
  );
}

function card(children: ReturnType<typeof h>[], key?: string) {
  return h(
    "div",
    {
      key,
      style: {
        background: "#ffffff",
        border: `1px solid ${BORDER}`,
        borderRadius: "8px",
        padding: "22px 22px 18px",
        margin: "0 0 12px",
      },
    },
    ...children,
  );
}

export function surveyEmail(
  answers: FormValues,
  claimLink: string | null,
): { subject: string; html: string; text: string } {
  const rows = surveyEmailAnswers(answers);
  const visible = surveyQuestions.filter((question) =>
    questionVisible(question.name, answers),
  );
  const header = card([
    h(
      "h1",
      {
        key: "title",
        style: {
          margin: "6px 0 12px",
          fontSize: "30px",
          lineHeight: "1.2",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: HEADING,
          textAlign: "center",
        },
      },
      "Help shape the future of ",
      h("img", {
        src: SURVEY_EMAIL_MARK,
        alt: "bb",
        width: 35,
        height: 28,
        style: { verticalAlign: "-3px", border: 0 },
      }),
      "!",
    ),
    h(
      "p",
      {
        key: "thanks",
        style: {
          margin: claimLink ? "0 0 22px" : "0 0 8px",
          fontSize: "16px",
          lineHeight: "1.6",
          textAlign: "center",
        },
      },
      "Thanks for filling out the survey! Here are your answers.",
    ),
    claimLink
      ? h(
          "p",
          { key: "claim", style: { margin: "0 0 8px", textAlign: "center" } },
          h(
            "a",
            {
              href: claimLink,
              style: {
                background: HEADING,
                color: "#ffffff",
                padding: "13px 24px",
                borderRadius: "8px",
                textDecoration: "none",
                display: "inline-block",
                fontSize: "16px",
                fontWeight: 600,
              },
            },
            "Claim my bb stickers",
          ),
        )
      : h("span", { key: "none" }),
  ]);
  const body = h(
    "div",
    {
      style: {
        fontFamily: FONT,
        color: INK,
        fontSize: "15px",
        lineHeight: "1.6",
        maxWidth: "640px",
        margin: "0 auto",
        padding: "24px 12px",
      },
    },
    header,
    ...visible.map((question, index) =>
      h(
        "div",
        { key: question.name },
        SECTIONS[question.name]
          ? h(
              "h2",
              {
                style: {
                  margin: "28px 4px 12px",
                  fontSize: "19px",
                  fontWeight: 650,
                  color: HEADING,
                },
              },
              SECTIONS[question.name],
            )
          : null,
        card([
          h(
            "p",
            {
              key: "label",
              style: {
                margin: "0 0 12px",
                fontSize: "15px",
                fontWeight: 600,
                color: HEADING,
              },
            },
            h(
              "span",
              { style: { fontWeight: 400, color: DIM } },
              `${index + 1}. `,
            ),
            label(question.name, question.label, answers),
          ),
          question.options.length
            ? h("div", { key: "answer" }, options(question, answers))
            : h(
                "div",
                { key: "answer" },
                textAnswer(answers[question.name]?.[0] ?? ""),
              ),
        ]),
      ),
    ),
    h(
      "p",
      {
        style: {
          margin: "24px 0 0",
          textAlign: "center",
          color: DIM,
          fontSize: "14px",
        },
      },
      "Thanks for building with us! — bb",
    ),
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f4f4f4">${renderToStaticMarkup(body)}</body></html>`;
  const text = [
    "Thanks for filling out the bb community survey! Here are your answers.",
    ...(claimLink ? [`Claim my bb stickers: ${claimLink}`] : []),
    ...rows.map((row) => `${row.label}\n${row.answer}`),
    "Thanks for building with us!\nbb",
  ].join("\n\n");
  return { subject: SURVEY_EMAIL_SUBJECT, html, text };
}

export async function sendSurveyEmail(
  apiKey: string | undefined,
  to: string,
  email: { subject: string; html: string; text: string },
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  if (!apiKey) return false;
  for (const delay of [0, 600, 1500]) {
    if (delay) await wait(delay);
    try {
      const response = await fetch(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: SURVEY_EMAIL_FROM, to: [to], ...email }),
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return true;
      if (response.status !== 429 && response.status < 500) return false;
    } catch {}
  }
  return false;
}
