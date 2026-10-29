import { Fragment } from "react";
import { renderToString } from "react-dom/server";
import { siteHeadLinks } from "../landing/page-head";
import { SiteNav, SiteFooter } from "../landing/site-chrome";
import siteChromeScript from "../generated/site-chrome.js?url";
import { THEME_INIT } from "../lib/theme";
import css from "./forms.css?url";
import {
  SOLO_WORK_OPTIONS,
  TEAM_WORK_OPTIONS,
  questionVisible,
  SURVEY_DESCRIPTION,
  SURVEY_TITLE,
  SOLD_OUT,
  ALREADY_CLAIMED,
  CLAIM_NOT_OPEN,
  SURVEY_PURPOSE,
  CITY_HELP,
  COMMUNITY_MAX,
  MEETUP_NOTE,
  EMAIL_NOTE,
  NOT_WORKING_ROLES,
  surveyQuestions,
  type FormErrors,
  type FormValues,
} from "./survey";

export type FormKind = "survey" | "merch";

const FORM_SCRIPT = `
const form = document.querySelector('form');
const scheme = matchMedia('(prefers-color-scheme: dark)');
scheme.addEventListener('change', e => document.documentElement.classList.toggle('dark', e.matches));
const progressKey = 'bb-community-survey';
const storage = (() => {
  try {
    return localStorage;
  } catch {
    return null;
  }
})();
if (form) {
  const fields = () => [...form.elements].filter(el => el.name && el.type !== 'hidden' && el.type !== 'submit');
  const isChoice = el => el.type === 'radio' || el.type === 'checkbox';
  let saved = null;
  try {
    saved = JSON.parse(storage?.getItem(progressKey) ?? 'null');
  } catch {}
  const prefilled = fields().some(el => isChoice(el) ? el.checked : el.value);
  if (saved && typeof saved === 'object' && !prefilled) {
    for (const el of fields()) {
      const value = saved[el.name];
      if (!Array.isArray(value)) continue;
      if (isChoice(el)) el.checked = value.includes(el.value);
      else el.value = String(value[0] ?? '');
    }
  }
  const save = () => {
    const data = {};
    for (const el of fields()) {
      if (isChoice(el) && !el.checked) continue;
      (data[el.name] ||= []).push(el.value);
    }
    try {
      storage?.setItem(progressKey, JSON.stringify(data));
    } catch {}
  };
  const update = () => {
    const workShown = !${JSON.stringify(NOT_WORKING_ROLES)}.includes(form.elements.namedItem('role').value);
    const work = workShown ? form.elements.namedItem('work').value : '';
    const shown = {
      work: workShown,
      company_size: Boolean(work) && work !== "I don't use bb for work",
      team_improve: ${JSON.stringify(TEAM_WORK_OPTIONS)}.includes(work),
      team_adopt: ${JSON.stringify(SOLO_WORK_OPTIONS)}.includes(work),
    };
    for (const [name, visible] of Object.entries(shown)) {
      const set = form.querySelector('[data-question="' + name + '"]');
      set.hidden = !visible;
      set.disabled = !visible;
      if (visible) continue;
      for (const input of set.querySelectorAll('input, textarea')) {
        if (input.type === 'radio') input.checked = false;
        else input.value = '';
      }
    }
    const city = form.elements.namedItem('city').value.trim();
    form.querySelector('[data-meetup-label]').textContent = 'Would you come to a bb meetup ' + (city ? 'in ' + city : 'near you') + '?';
    const picks = form.querySelectorAll('[name="community"]');
    const full = [...picks].filter(box => box.checked).length >= ${COMMUNITY_MAX};
    for (const box of picks) box.disabled = full && !box.checked;
    for (const input of form.querySelectorAll('[data-other]')) {
      const selected = form.querySelector('[name="' + input.dataset.other + '"][value="Other"]:checked');
      input.hidden = selected?.value !== 'Other';
      input.disabled = input.hidden;
      input.required = !input.hidden;
    }
    for (const set of form.querySelectorAll('fieldset[data-question]')) {
      const boxes = set.querySelectorAll('input[type="checkbox"]');
      if (boxes.length && [...boxes].some(box => box.checked)) boxes[0].setCustomValidity('');
    }
    save();
  };
  form.addEventListener('submit', e => {
    for (const set of form.querySelectorAll('fieldset[data-question]')) {
      const boxes = set.querySelectorAll('input[type="checkbox"]');
      if (set.disabled || !boxes.length || [...boxes].some(box => box.checked)) continue;
      boxes[0].setCustomValidity('Please pick at least one.');
      boxes[0].reportValidity();
      e.preventDefault();
      return;
    }
  });
  form.addEventListener('change', e => {
    update();
    if (e.target.value === 'Other' && e.target.checked) form.querySelector('[data-other="' + e.target.name + '"]')?.focus();
  });
  form.addEventListener('input', update);
  update();
} else if (document.querySelector('[data-survey-complete]')) {
  storage?.removeItem(progressKey);
}
`;

function shuffled(options: readonly string[], fixedLast: number): string[] {
  const result = options.slice(0, options.length - fixedLast);
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return [...result, ...options.slice(options.length - fixedLast)];
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
      {surveyQuestions.map((question) => (
        <Fragment key={question.name}>
          {question.name === "discovery" && (
            <h2 className="community-section">Getting to know you</h2>
          )}
          {question.name === "love" && (
            <h2 className="community-section">Your experience with bb</h2>
          )}
          {question.name === "community" && (
            <h2 className="community-section">
              What you'd like from the bb community
            </h2>
          )}
          <fieldset
            id={`question-${question.name}`}
            data-question={question.name}
            hidden={!questionVisible(question.name, values)}
            disabled={!questionVisible(question.name, values)}
            aria-describedby={
              errors[question.name] ? `${question.name}-error` : undefined
            }
          >
            <legend>
              <span className="community-number" />
              <span
                data-meetup-label={question.name === "meetup" ? "" : undefined}
              >
                {question.name === "meetup" && city
                  ? `Would you come to a bb meetup in ${city}?`
                  : question.label}
              </span>
              {question.type === "checkbox" &&
                (question.name === "community"
                  ? ` (pick up to ${COMMUNITY_MAX})`
                  : " (pick any)")}
              <span className="community-required" aria-hidden>
                {" *"}
              </span>
            </legend>
            {question.name === "city" && (
              <p className="community-help">{CITY_HELP}</p>
            )}
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
                      required={question.type === "radio"}
                      defaultChecked={values[question.name]?.includes(option)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            ) : question.type === "textarea" ? (
              <textarea
                name={question.name}
                aria-label={question.label}
                placeholder={question.placeholder}
                required
                rows={3}
                maxLength={250}
                defaultValue={
                  questionVisible(question.name, values)
                    ? (values[question.name]?.[0] ?? "")
                    : ""
                }
              />
            ) : (
              <input
                type="text"
                name={question.name}
                aria-label={question.label}
                placeholder={question.placeholder}
                required
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
                placeholder="Please specify"
                maxLength={250}
                defaultValue={values[`${question.name}_other`]?.[0] ?? ""}
                aria-describedby={
                  errors[`${question.name}_other`]
                    ? `${question.name}_other-error`
                    : undefined
                }
              />
            )}
            {question.name === "meetup" && (
              <p className="community-note">{MEETUP_NOTE}</p>
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
      <label className="community-meetup" htmlFor="email">
        <strong>Last step.</strong> Your email, so we can send your stickers and
        share your results with you.
        <span className="community-required" aria-hidden>
          {" *"}
        </span>
      </label>
      <div className="community-email" id="question-email">
        <div className="community-email-row">
          <input
            type="email"
            required
            autoComplete="email"
            name="email"
            id="email"
            placeholder="you@example.com"
            maxLength={250}
            defaultValue={values.email?.[0] ?? ""}
            aria-describedby={errors.email ? "email-error" : undefined}
          />
          <button className="btn btn-primary" type="submit">
            Send my answers
          </button>
        </div>
        <p className="community-note">{EMAIL_NOTE}</p>
        {errors.email && (
          <p className="community-error" id="email-error">
            {errors.email}
          </p>
        )}
      </div>
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
  claimLink = null,
  claimOpen = true,
  duplicate = false,
  alreadyClaimed = false,
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
  claimLink?: string | null;
  claimOpen?: boolean;
  duplicate?: boolean;
  alreadyClaimed?: boolean;
  jotform?: string | null;
}): Response {
  const nonce = crypto.randomUUID();
  const referrerPolicy = kind === "survey" ? "same-origin" : "no-referrer";
  const title = kind === "survey" ? SURVEY_TITLE : "thank you 🧡";
  const html = renderToString(
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
        <div className="wrap">
          <div id="site-nav">
            <SiteNav />
          </div>
          <main className="community-wrap">
            {complete ? (
              <section
                className="community-thanks"
                data-survey-complete={kind === "survey" ? "" : undefined}
              >
                {duplicate ? (
                  <p>
                    we already have your answers — thank you 🙏 if you saved
                    your sticker link, you can still use it.
                  </p>
                ) : (
                  <>
                    <p>
                      <strong>Thanks!</strong>{" "}
                      {claimLink
                        ? "Your bb stickers are ready."
                        : alreadyClaimed
                          ? ALREADY_CLAIMED
                          : claimOpen
                            ? SOLD_OUT
                            : CLAIM_NOT_OPEN}
                    </p>
                    {claimLink && (
                      <>
                        <p>
                          <a
                            className="btn btn-primary"
                            href={claimLink}
                            rel="noreferrer"
                          >
                            Claim my stickers
                          </a>
                        </p>
                        <p>
                          It opens a free checkout for your US mailing address.
                          The link works once.
                        </p>
                      </>
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
                  {kind === "survey" ? (
                    <h1 aria-label={title}>
                      Help shape the future of{" "}
                      <span className="community-nowrap">
                        <span
                          className="bb-mark community-heading-mark"
                          aria-hidden
                        />
                        !
                      </span>
                    </h1>
                  ) : (
                    <h1>{title}</h1>
                  )}
                  <p>
                    {kind === "survey"
                      ? SURVEY_DESCRIPTION
                      : "you've helped people in the discord, built cool stuff, and told friends about bb. we notice, and it means a lot. so we made some merch and want you to have some first."}
                  </p>
                  {kind === "survey" && <p>{SURVEY_PURPOSE}</p>}
                  {kind === "survey" && (
                    <p className="community-help">
                      <span className="community-required" aria-hidden>
                        *
                      </span>{" "}
                      Required
                    </p>
                  )}
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
          <div id="site-footer">
            <SiteFooter />
          </div>
        </div>
        <script nonce={nonce} src={siteChromeScript} defer />
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
