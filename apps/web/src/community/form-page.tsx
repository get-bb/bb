import { Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { siteHeadLinks } from "../landing/page-head";
import { THEME_INIT } from "../lib/theme";
import css from "./forms.css?url";
import {
  SURVEY_DESCRIPTION,
  SURVEY_TITLE,
  SOLD_OUT,
  SURVEY_PURPOSE,
  MEETUP_FRAMING,
  MEETUP_DECLINE,
  surveyQuestions,
  type FormErrors,
  type FormValues,
} from "./survey";

export type FormKind = "survey" | "merch";

const FORM_SCRIPT = `
const form = document.querySelector('form');
const scheme = matchMedia('(prefers-color-scheme: dark)');
scheme.addEventListener('change', e => document.documentElement.classList.toggle('dark', e.matches));
if (form) {
  const update = () => {
    const city = form.elements.namedItem('city').value.trim();
    form.querySelector('[data-meetup-label]').textContent = 'If there were a bb meetup near ' + (city || 'you') + ', how would you like to be involved?';
    for (const input of form.querySelectorAll('[data-other]')) {
      const selected = form.querySelector('[name="' + input.dataset.other + '"][value="Other"]:checked');
      input.hidden = selected?.value !== 'Other';
      input.disabled = input.hidden;
    }
  };
  form.addEventListener('change', e => {
    if (e.target.name === 'meetup' && e.target.checked) {
      for (const input of form.querySelectorAll('[name="meetup"]')) {
        if (input !== e.target && (e.target.value === ${JSON.stringify(MEETUP_DECLINE)} || input.value === ${JSON.stringify(MEETUP_DECLINE)})) input.checked = false;
      }
    }
    update();
  });
  form.addEventListener('input', update);
  update();
}
`;

function shuffled(options: readonly string[], fixedLast: number): string[] {
  const result = options.slice(0, -fixedLast);
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return [...result, ...options.slice(-fixedLast)];
}

function Survey({
  values,
  errors,
}: {
  values: FormValues;
  errors: FormErrors;
}) {
  const city = values.city?.[0]?.trim();
  return (
    <>
      {surveyQuestions.map((question, index) => (
        <Fragment key={question.name}>
          {question.name === "discovery" && (
            <h2 className="community-section">Getting to know you</h2>
          )}
          {question.name === "city" && (
            <h2 className="community-section">bb meetups</h2>
          )}
          {question.name === "community" && (
            <h2 className="community-section">
              What you'd like from the bb community
            </h2>
          )}
          {question.name === "city" && (
            <p className="community-meetup">{MEETUP_FRAMING}</p>
          )}
          <fieldset
            id={`question-${question.name}`}
            data-question={question.name}
            aria-describedby={
              errors[question.name] ? `${question.name}-error` : undefined
            }
          >
            <legend>
              <span className="community-number">{index + 1}.</span>{" "}
              <span
                data-meetup-label={question.name === "meetup" ? "" : undefined}
              >
                {question.name === "meetup" && city
                  ? `If there were a bb meetup near ${city}, how would you like to be involved?`
                  : question.label}
              </span>
              {question.type === "checkbox" && " (pick any)"}
            </legend>
            {question.options.length ? (
              <div className="community-options">
                {(question.name === "discovery"
                  ? shuffled(question.options, 2)
                  : question.name === "community"
                    ? shuffled(question.options, 1)
                    : question.options
                ).map((option) => (
                  <label key={option} className="community-option">
                    <input
                      type={question.type === "checkbox" ? "checkbox" : "radio"}
                      name={question.name}
                      value={option}
                      defaultChecked={values[question.name]?.includes(option)}
                    />
                    <span>{option === "Other" ? "Other:" : option}</span>
                  </label>
                ))}
              </div>
            ) : question.type === "textarea" ? (
              <textarea
                name={question.name}
                aria-label={question.label}
                placeholder={question.placeholder}
                rows={3}
                maxLength={250}
                defaultValue={values[question.name]?.[0] ?? ""}
              />
            ) : (
              <input
                type="text"
                name={question.name}
                aria-label={question.label}
                placeholder={question.placeholder}
                maxLength={250}
                defaultValue={values[question.name]?.[0] ?? ""}
              />
            )}
            {question.options.includes("Other") && (
              <input
                type="text"
                name={`${question.name}_other`}
                data-other={question.name}
                aria-label={`${question.label} Other`}
                maxLength={250}
                defaultValue={values[`${question.name}_other`]?.[0] ?? ""}
                aria-describedby={
                  errors[`${question.name}_other`]
                    ? `${question.name}_other-error`
                    : undefined
                }
              />
            )}
            {errors[`${question.name}_other`] && (
              <p
                className="community-error"
                id={`${question.name}_other-error`}
              >
                {errors[`${question.name}_other`]}
              </p>
            )}
            {errors[question.name] && (
              <p className="community-error" id={`${question.name}-error`}>
                {errors[question.name]}
              </p>
            )}
          </fieldset>
        </Fragment>
      ))}
      <p className="community-meetup">
        <strong>Last step.</strong> Your email, so we can send your stickers and
        share the results with you.
      </p>
      <div className="community-field" id="question-email">
        <label htmlFor="email">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          name="email"
          id="email"
          maxLength={250}
          defaultValue={values.email?.[0] ?? ""}
          aria-describedby={errors.email ? "email-error" : undefined}
        />
        {errors.email && (
          <p className="community-error" id="email-error">
            {errors.email}
          </p>
        )}
      </div>
      <p className="community-help">
        We won't add you to a marketing list or share it.
      </p>
    </>
  );
}

export function formPage({
  kind,
  id,
  values = {},
  errors = {},
  message = "",
  complete = false,
  status = 200,
  unavailable = false,
  stickerCode = null,
  duplicate = false,
  jotform = null,
}: {
  kind: FormKind;
  id: string;
  values?: FormValues;
  errors?: FormErrors;
  message?: string;
  complete?: boolean;
  status?: number;
  unavailable?: boolean;
  stickerCode?: string | null;
  duplicate?: boolean;
  jotform?: string | null;
}): Response {
  const nonce = crypto.randomUUID();
  const referrerPolicy = kind === "survey" ? "same-origin" : "no-referrer";
  const title = kind === "survey" ? SURVEY_TITLE : "thank you 🧡";
  const html = renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content={referrerPolicy} />
        <link rel="icon" href="/favicon-32x32.png" />
        {siteHeadLinks(css).map((link, index) => (
          <link key={index} {...link} />
        ))}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_INIT }}
        />
      </head>
      <body className="community-page">
        <div className="community-wrap">
          <header className="community-header">
            <a className="logo" href="/" aria-label="bb home">
              <span className="bb-mark logo-mark" />
            </a>
          </header>
          <main>
            {complete ? (
              <section className="community-thanks">
                {duplicate ? (
                  <p>
                    we already have your answers — thank you 🙏 if you saved
                    your sticker code, you can still use its claim link.
                  </p>
                ) : (
                  <>
                    <p>
                      <strong>Thanks!</strong>{" "}
                      {stickerCode ? (
                        <>
                          Your bb stickers:{" "}
                          <a
                            href={`/community/merch?c=${encodeURIComponent(stickerCode)}`}
                          >
                            Claim them
                          </a>{" "}
                          (one-time code <code>{stickerCode}</code>)
                        </>
                      ) : (
                        SOLD_OUT
                      )}
                    </p>
                    {stickerCode && (
                      <p>
                        It opens a short private form for your US mailing
                        address. Only the person packing your envelope sees it,
                        it isn't linked to your answers, and we delete it once
                        your package ships.
                      </p>
                    )}
                    <p>
                      Outside the US? We'll post in Discord when we can ship to
                      you.
                    </p>
                    <p>We'll email you the results when they're in.</p>
                  </>
                )}
              </section>
            ) : unavailable ? (
              <section className="community-thanks">
                <p>
                  hmm, this link isn't working. DM brsbl on discord and we'll
                  sort it out.
                </p>
              </section>
            ) : (
              <>
                <div className="community-intro">
                  <h1>{title}</h1>
                  <p>
                    {kind === "survey"
                      ? SURVEY_DESCRIPTION
                      : "you've helped people in the discord, built cool stuff, and told friends about bb. we notice, and it means a lot. so we made some merch and want you to have some first."}
                  </p>
                  {kind === "survey" && <p>{SURVEY_PURPOSE}</p>}
                  {kind === "merch" && <p>— brsbl &amp; the bb team</p>}
                </div>
                {(message || Object.keys(errors).length > 0) && (
                  <div className="community-notice" role="alert">
                    <strong>
                      {message || "Please check the marked questions."}
                    </strong>
                    {Object.entries(errors).map(([name, error]) => (
                      <p key={name}>
                        <a href={`#question-${name}`}>
                          {surveyQuestions.find(
                            (question) => question.name === name,
                          )?.label ?? name}
                          : {error}
                        </a>
                      </p>
                    ))}
                  </div>
                )}
                {kind === "survey" ? (
                  <form
                    method="post"
                    action="/community/survey"
                    autoComplete="off"
                  >
                    <input type="hidden" name="submission_id" value={id} />
                    <Survey values={values} errors={errors} />
                    <div className="community-submit">
                      <button className="btn primary" type="submit">
                        Send my answers
                      </button>
                    </div>
                  </form>
                ) : (
                  <section className="community-merch">
                    <h2>where should we send it?</h2>
                    {jotform ? (
                      <>
                        <iframe
                          title="Private merch mailing form"
                          src={jotform}
                          referrerPolicy="no-referrer"
                        />
                        <p>
                          <a
                            href={jotform}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            open the private form
                          </a>
                        </p>
                      </>
                    ) : (
                      <p className="community-notice">
                        The private mailing form isn't open yet. Please keep
                        this link and check back later.
                      </p>
                    )}
                    <p className="community-help">
                      Only the person packing your envelope can read this, plus
                      Pirate Ship, the service that prints the shipping label.
                      Once it ships, we delete it from our form and ask Pirate
                      Ship to delete its copy.
                    </p>
                  </section>
                )}
              </>
            )}
          </main>
          <footer className="community-footer">
            <a href="/privacy">Privacy</a>
          </footer>
        </div>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: FORM_SCRIPT }}
        />
      </body>
    </html>,
  );
  const frameSource = jotform ? new URL(jotform).origin : "'none'";
  return new Response(`<!doctype html>${html}`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": referrerPolicy,
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; frame-src ${frameSource}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}
