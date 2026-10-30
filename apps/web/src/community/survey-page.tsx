import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import {
  formValues,
  questionVisible,
  surveyAnswers,
  surveyQuestions,
  surveyReply,
  validateSurvey,
  type FormErrors,
  type FormValues,
  type SurveyOrder,
  type SurveyReply,
} from "./survey";

const SURVEY_API_PATH = "/api/community/survey";
const SURVEY_DESCRIPTION =
  "We're figuring out what's next for bb, from product changes to meetups and merch, and we'd love your input.";
const SURVEY_PURPOSE =
  "This should take ~3 min. As a small thank you, we'll send you bb stickers free of charge (US-only for now). Thanks for building with us!";
const CITY_HELP = "So we know where to start meetups.";
const RESEARCH_CALL_NOTE =
  "We'll email you to find a time. We'd love to hear your feedback and share tips.";
const MEETUP_NOTE =
  "If you help organize, we'll help with budget, merch and more.";
const QUESTION_NOTES: Record<string, string> = {
  meetup: MEETUP_NOTE,
  research_call: RESEARCH_CALL_NOTE,
};
const EMAIL_NOTE = "We won't send you any marketing emails.";
const PROGRESS_KEY = "bb-community-survey";
const SECTIONS: Record<string, string> = {
  discovery: "Getting to know you",
  love: "Your experience with bb",
  community: "What you'd like from the bb community",
};

function readProgress(): FormValues {
  try {
    const saved = formValues.safeParse(
      JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "null"),
    );
    return saved.success ? saved.data : {};
  } catch {
    return {};
  }
}

function writeProgress(values: FormValues | null) {
  try {
    if (values) localStorage.setItem(PROGRESS_KEY, JSON.stringify(values));
    else localStorage.removeItem(PROGRESS_KEY);
  } catch {}
}

async function send(id: string, answers: FormValues): Promise<SurveyReply> {
  try {
    const response = await fetch(SURVEY_API_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submission_id: id, answers }),
    });
    const body = surveyReply.safeParse(await response.json());
    if (body.success) return body.data;
  } catch {}
  return { error: "We couldn't send your answers. Please try again." };
}

function Question({
  question,
  values,
  errors,
  order,
  onChange,
}: {
  question: (typeof surveyQuestions)[number];
  values: FormValues;
  errors: FormErrors;
  order: SurveyOrder;
  onChange: (name: string, value: string[]) => void;
}) {
  const { name } = question;
  const selected = values[name] ?? [];
  const city = values.city?.[0]?.trim();
  const otherName = `${name}_other`;
  const other = useRef<HTMLInputElement>(null);
  const pick = (option: string, checked: boolean) => {
    const next =
      question.type === "radio"
        ? [option]
        : checked
          ? selected.filter((value) => value !== option)
          : [...selected, option];
    if (option !== "Other" || checked) return onChange(name, next);
    flushSync(() => onChange(name, next));
    other.current?.focus();
  };
  return (
    <fieldset
      id={`question-${name}`}
      data-question={name}
      aria-describedby={errors[name] ? `${name}-error` : undefined}
    >
      <legend>
        <span className="community-number" />
        <span>
          {name === "meetup" && city
            ? `Would you come to a bb meetup in ${city}?`
            : question.label}
        </span>
        {question.type === "checkbox" && " (pick any)"}
        <span className="community-required" aria-hidden>
          {" *"}
        </span>
      </legend>
      {name === "city" && <p className="community-help">{CITY_HELP}</p>}
      {question.options.length ? (
        <div className="community-options">
          {(order[name] ?? question.options).map((option) => {
            const checked = selected.includes(option);
            return (
              <label key={option} className="community-option">
                <input
                  type={question.type === "checkbox" ? "checkbox" : "radio"}
                  name={name}
                  value={option}
                  required={question.type === "radio"}
                  checked={checked}
                  onChange={() => pick(option, checked)}
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      ) : question.type === "textarea" ? (
        <textarea
          name={name}
          aria-label={question.label}
          required
          rows={3}
          maxLength={250}
          value={selected[0] ?? ""}
          onChange={(event) => onChange(name, [event.target.value])}
        />
      ) : (
        <input
          type="text"
          name={name}
          aria-label={question.label}
          placeholder={question.placeholder}
          required
          maxLength={250}
          value={selected[0] ?? ""}
          onChange={(event) => onChange(name, [event.target.value])}
        />
      )}
      {selected.includes("Other") && (
        <input
          type="text"
          name={otherName}
          aria-label={`${question.label} Other`}
          placeholder="Please specify"
          required
          ref={other}
          maxLength={250}
          value={values[otherName]?.[0] ?? ""}
          onChange={(event) => onChange(otherName, [event.target.value])}
          aria-describedby={
            errors[otherName] ? `${otherName}-error` : undefined
          }
          data-other=""
        />
      )}
      {QUESTION_NOTES[name] && (
        <p className="community-note">{QUESTION_NOTES[name]}</p>
      )}
      {[otherName, name].map(
        (field) =>
          errors[field] && (
            <p key={field} className="community-error" id={`${field}-error`}>
              {errors[field]}
            </p>
          ),
      )}
    </fieldset>
  );
}

export function SurveyPage({
  title,
  order,
}: {
  title: string;
  order: SurveyOrder;
}) {
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SurveyReply["result"]>();
  const submissionId = useRef("");
  const notice = useRef<HTMLDivElement>(null);
  const thanks = useRef<HTMLElement>(null);

  useEffect(() => setValues(readProgress()), []);
  useEffect(() => {
    if (message || Object.keys(errors).length) notice.current?.focus();
  }, [message, errors]);
  useEffect(() => {
    if (result) thanks.current?.focus();
  }, [result]);

  const change = (name: string, value: string[]) => {
    const next = { ...values, [name]: value };
    setValues(next);
    writeProgress(next);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateSurvey(values);
    setErrors(found);
    setMessage("");
    if (Object.keys(found).length) return;
    submissionId.current ||= crypto.randomUUID();
    setSending(true);
    const reply = await send(submissionId.current, surveyAnswers(values));
    setSending(false);
    setErrors(reply.errors ?? {});
    setMessage(reply.error ?? "");
    if (!reply.result) return;
    writeProgress(null);
    setResult(reply.result);
    window.scrollTo(0, 0);
  }

  return (
    <div className="wrap community-page">
      <SiteNav />
      <main className="community-wrap">
        {result ? (
          <section
            className="community-thanks"
            role="status"
            tabIndex={-1}
            ref={thanks}
          >
            <p>
              <strong>Thanks!</strong>{" "}
              {result.duplicate
                ? "We already have your answers."
                : "We got your answers."}
            </p>
          </section>
        ) : (
          <>
            <div className="community-intro">
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
              <p>{SURVEY_DESCRIPTION}</p>
              <p>{SURVEY_PURPOSE}</p>
              <p className="community-help">
                <span className="community-required" aria-hidden>
                  *
                </span>{" "}
                Required
              </p>
            </div>
            {(message || Object.keys(errors).length > 0) && (
              <div
                className="community-notice"
                role="alert"
                tabIndex={-1}
                ref={notice}
              >
                <strong>
                  {message || "Please check the marked questions."}
                </strong>
                {Object.entries(errors).map(([name, error]) => {
                  const label =
                    surveyQuestions.find(
                      (question) =>
                        question.name === name.replace(/_other$/, ""),
                    )?.label ?? "Email";
                  return (
                    <p key={name}>
                      <a href={`#question-${name.replace(/_other$/, "")}`}>
                        {/[?.!]$/.test(label)
                          ? `${label} ${error}`
                          : `${label}: ${error}`}
                      </a>
                    </p>
                  );
                })}
              </div>
            )}
            <form
              method="post"
              action={SURVEY_API_PATH}
              onSubmit={submit}
              autoComplete="off"
            >
              {surveyQuestions.map(
                (question) =>
                  questionVisible(question.name, values) && (
                    <Fragment key={question.name}>
                      {SECTIONS[question.name] && (
                        <h2 className="community-section">
                          {SECTIONS[question.name]}
                        </h2>
                      )}
                      <Question
                        question={question}
                        values={values}
                        errors={errors}
                        order={order}
                        onChange={change}
                      />
                    </Fragment>
                  ),
              )}
              <label className="community-meetup" htmlFor="email">
                <strong>Last step.</strong> Your email, so we can send your
                stickers and share your results with you.
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
                    value={values.email?.[0] ?? ""}
                    onChange={(event) => change("email", [event.target.value])}
                    aria-describedby={errors.email ? "email-error" : undefined}
                  />
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={sending}
                  >
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
            </form>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
