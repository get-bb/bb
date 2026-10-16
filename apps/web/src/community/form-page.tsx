import { renderToStaticMarkup } from "react-dom/server";
import { siteHeadLinks } from "../landing/page-head";
import { THEME_INIT } from "../lib/theme";
import css from "./forms.css?url";
import {
  SURVEY_DESCRIPTION,
  SURVEY_TITLE,
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
  const validate = () => {
    for (const group of form.querySelectorAll('[data-question]')) {
      const checks = [...group.querySelectorAll('input[type="checkbox"]')];
      const checked = checks.filter(el => el.checked);
      let error = '';
      if (checks.length && !checked.length) error = 'Please answer this question.';
      if (group.dataset.max && checked.length > Number(group.dataset.max)) error = 'Pick up to 3';
      if (group.dataset.question === 'tools' && checked.length > 1 && checked.some(el => ['None currently', 'Prefer not to say'].includes(el.value))) error = "If choosing 'None currently' or 'Prefer not to say', select only that option.";
      if (checks[0]) checks[0].setCustomValidity(error);
      const message = group.querySelector('[data-live-error]');
      if (message) message.textContent = checked.length ? error : '';
      const other = group.querySelector('[data-other]');
      if (other) {
        const selected = [...group.querySelectorAll('input:checked')].some(el => el.value === 'Other');
        other.required = selected;
        other.hidden = !selected;
        other.disabled = !selected;
      }
    }
  };
  form.addEventListener('change', validate);
  form.addEventListener('submit', e => {
    validate();
    if (!form.reportValidity()) e.preventDefault();
  });
  validate();
}
`;

function TextField({
  name,
  label,
  multiline = false,
  values,
  error,
  autoComplete,
  maxLength = 250,
}: {
  name: string;
  label: string;
  multiline?: boolean;
  values: FormValues;
  error?: string;
  autoComplete?: string;
  maxLength?: number;
}) {
  const props = {
    id: name,
    name,
    required: true,
    maxLength,
    autoComplete,
    defaultValue: values[name]?.[0] ?? "",
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${name}-error` : undefined,
  };
  return (
    <div className="community-field">
      <label htmlFor={name}>{label}</label>
      {multiline ? (
        <textarea {...props} rows={4} />
      ) : (
        <input {...props} type="text" />
      )}
      {error && (
        <p className="community-error" id={`${name}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

function Survey({
  values,
  errors,
}: {
  values: FormValues;
  errors: FormErrors;
}) {
  return (
    <>
      {surveyQuestions.map((question, index) => {
        const error = errors[question.name];
        const description =
          [
            question.help ? `${question.name}-help` : "",
            error ? `${question.name}-error` : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined;
        return (
          <fieldset
            key={question.name}
            id={`question-${question.name}`}
            data-question={question.name}
            data-max={question.maxChoices ?? undefined}
            aria-describedby={description}
          >
            <legend>
              <span className="community-number">{index + 1}.</span>{" "}
              {question.label}
              {question.optional && (
                <span className="community-optional"> (optional)</span>
              )}
            </legend>
            {question.help && (
              <p className="community-help" id={`${question.name}-help`}>
                {question.help}
              </p>
            )}
            {question.options.length > 0 ? (
              <div className="community-options">
                {question.options.map((option) => (
                  <label key={option} className="community-option">
                    <input
                      type={question.type === "checkbox" ? "checkbox" : "radio"}
                      name={question.name}
                      value={option}
                      required={question.type === "radio" && !question.optional}
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
                required={!question.optional}
                rows={4}
                maxLength={2000}
                defaultValue={values[question.name]?.[0] ?? ""}
              />
            ) : (
              <input
                type="text"
                name={question.name}
                aria-label={question.label}
                required={!question.optional}
                maxLength={250}
                defaultValue={values[question.name]?.[0] ?? ""}
              />
            )}
            {question.other && (
              <input
                type="text"
                data-other
                name={`${question.name}_other`}
                aria-label={`Other: ${question.label}`}
                placeholder="Your answer"
                maxLength={250}
                defaultValue={values[`${question.name}_other`]?.[0] ?? ""}
              />
            )}
            <p className="community-error" data-live-error aria-live="polite" />
            {error && (
              <p className="community-error" id={`${question.name}-error`}>
                {error}
              </p>
            )}
          </fieldset>
        );
      })}
    </>
  );
}

export function formPage({
  kind,
  id,
  enabled,
  values = {},
  errors = {},
  message = "",
  complete = false,
  status = 200,
  invitation = null,
  unavailable = false,
}: {
  kind: FormKind;
  id: string;
  enabled: boolean;
  values?: FormValues;
  errors?: FormErrors;
  message?: string;
  complete?: boolean;
  status?: number;
  invitation?: { code: string; hat: boolean } | null;
  unavailable?: boolean;
}): Response {
  const nonce = crypto.randomUUID();
  const title = kind === "survey" ? SURVEY_TITLE : "A little thank-you from bb";
  const html = renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="same-origin" />
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
            <span>Made with our community</span>
          </header>
          <main>
            {complete ? (
              <section className="community-thanks">
                <p className="community-eyebrow">Thank you</p>
                <h1>
                  {kind === "survey"
                    ? "Thanks for helping shape bb."
                    : "We've got your details."}
                </h1>
                <p>
                  {kind === "survey"
                    ? "Your answers will help us plan the next community events and merch. We're glad you're here."
                    : "We'll use them to send your thank-you. No need to do anything else."}
                </p>
                <a href="/">Back to bb</a>
              </section>
            ) : unavailable ? (
              <section className="community-thanks">
                <h1>This personal link isn’t available.</h1>
                <p>Please ask the person who sent it for a new link.</p>
              </section>
            ) : (
              <>
                <div className="community-intro">
                  <p className="community-eyebrow">
                    {kind === "survey"
                      ? "A few questions, from the bb team"
                      : "From the bb team, to you"}
                  </p>
                  <h1>{title}</h1>
                  <p>
                    {kind === "survey"
                      ? SURVEY_DESCRIPTION
                      : "Thanks for being part of bb. We'd love to send a little something your way. Tell us where it should go."}
                  </p>
                  <p className="community-help">
                    {kind === "survey"
                      ? "About 3 minutes · All questions are required except the last three."
                      : "Just the details we need to ship. No email, phone number or Discord handle."}
                  </p>
                </div>
                {!enabled && (
                  <p className="community-notice">
                    Preview for review. Responses are not being collected yet.
                  </p>
                )}
                {(message || Object.keys(errors).length > 0) && (
                  <div className="community-notice" role="alert">
                    <strong>
                      {message || "Please check the marked questions."}
                    </strong>
                    {Object.entries(errors).map(([name, error]) => (
                      <p key={name}>
                        <a
                          href={
                            kind === "survey" ? `#question-${name}` : `#${name}`
                          }
                        >
                          {kind === "survey"
                            ? surveyQuestions.find((q) => q.name === name)
                                ?.label
                            : name}
                          : {error}
                        </a>
                      </p>
                    ))}
                  </div>
                )}
                <form
                  method="post"
                  action={`/community/${kind}${invitation ? `?c=${encodeURIComponent(invitation.code)}` : ""}`}
                  autoComplete={kind === "survey" ? "off" : "on"}
                >
                  <input type="hidden" name="submission_id" value={id} />
                  {kind === "survey" ? (
                    <Survey values={values} errors={errors} />
                  ) : (
                    <div className="community-address">
                      <TextField
                        name="name"
                        label="Name for the label"
                        values={values}
                        error={errors.name}
                        autoComplete="shipping name"
                      />
                      <TextField
                        name="address"
                        label="Shipping address"
                        multiline
                        values={values}
                        error={errors.address}
                        autoComplete="shipping street-address"
                        maxLength={1000}
                      />
                      <p className="community-help">
                        Include your city, state or region, and postal code.
                      </p>
                      <TextField
                        name="country"
                        label="Country"
                        values={values}
                        error={errors.country}
                        autoComplete="shipping country-name"
                      />
                      {invitation?.hat && (
                        <fieldset id="hat">
                          <legend>Want a hat?</legend>
                          <div className="community-options">
                            {["Yes", "No"].map((option) => (
                              <label className="community-option" key={option}>
                                <input
                                  type="radio"
                                  name="hat"
                                  value={option}
                                  required
                                  defaultChecked={values.hat?.includes(option)}
                                />
                                <span>{option}</span>
                              </label>
                            ))}
                          </div>
                          {errors.hat && (
                            <p className="community-error">{errors.hat}</p>
                          )}
                        </fieldset>
                      )}
                    </div>
                  )}
                  <div className="community-submit">
                    <button
                      className="btn primary"
                      type="submit"
                      disabled={!enabled}
                    >
                      {kind === "survey"
                        ? "Send my answers"
                        : "Send my shipping details"}
                    </button>
                    <p className="community-help">
                      {kind === "survey"
                        ? "Your answers are private to the bb team."
                        : "Only used to send your merch. We'll delete your address from our shipping list after it ships."}
                    </p>
                  </div>
                </form>
              </>
            )}
          </main>
          <footer className="community-footer">
            <span>From the people building bb.</span>
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
  return new Response(`<!doctype html>${html}`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "same-origin",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}
