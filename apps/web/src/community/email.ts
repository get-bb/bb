import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { surveyQuestions, type FormValues } from "./survey";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
export const SURVEY_EMAIL_FROM = "bb <updates@mail.getbb.app>";
export const SURVEY_EMAIL_SUBJECT = "Your bb survey answers";

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

export function surveyEmail(
  answers: FormValues,
  claimLink: string | null,
): { subject: string; html: string; text: string } {
  const rows = surveyEmailAnswers(answers);
  const html = renderToStaticMarkup(
    h(
      "div",
      {
        style: {
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          color: "#111",
          fontSize: "15px",
          lineHeight: "1.6",
          maxWidth: "560px",
        },
      },
      h(
        "p",
        null,
        "Thanks for filling out the bb community survey! Here are your answers.",
      ),
      ...rows.map((row) =>
        h(
          "p",
          { key: row.label },
          h("strong", null, row.label),
          h("br"),
          row.answer,
        ),
      ),
      claimLink
        ? h(
            "p",
            { style: { margin: "28px 0" } },
            h(
              "a",
              {
                href: claimLink,
                style: {
                  background: "#111",
                  color: "#fff",
                  padding: "12px 20px",
                  borderRadius: "8px",
                  textDecoration: "none",
                  display: "inline-block",
                },
              },
              "Claim my bb stickers",
            ),
          )
        : null,
      h("p", null, "Thanks for building with us!", h("br"), "bb"),
    ),
  );
  const text = [
    "Thanks for filling out the bb community survey! Here are your answers.",
    ...rows.map((row) => `${row.label}\n${row.answer}`),
    ...(claimLink ? [`Claim my bb stickers: ${claimLink}`] : []),
    "Thanks for building with us!\nbb",
  ].join("\n\n");
  return { subject: SURVEY_EMAIL_SUBJECT, html, text };
}

export async function sendSurveyEmail(
  apiKey: string | undefined,
  to: string,
  email: { subject: string; html: string; text: string },
): Promise<boolean> {
  if (!apiKey) return false;
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
    return response.ok;
  } catch {
    return false;
  }
}
