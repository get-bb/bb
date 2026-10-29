import { z } from "zod";

export const SURVEY_TITLE = "Help shape the future of bb!";
export const SURVEY_DESCRIPTION =
  "We're figuring out what's next for bb, from product changes to meetups and merch, and we'd love your input.";
export const SURVEY_PURPOSE =
  "This should take ~3 min. As a small thank you, we'll send you bb stickers free of charge (US addresses for now). Thanks for building with us!";
export const CITY_HELP = "So we know where to start meetups.";
export const COMMUNITY_MAX = 3;
export const TEAM_WORK_OPTIONS = ["2–4 people", "5 or more"];
export const SOLO_WORK_OPTIONS = ["Just me"];
export function questionVisible(name: string, values: FormValues): boolean {
  const work = values.work?.[0] ?? "";
  if (name === "company_size")
    return Boolean(work && work !== "I don't use bb for work");
  if (name === "team_improve") return TEAM_WORK_OPTIONS.includes(work);
  if (name === "team_adopt") return SOLO_WORK_OPTIONS.includes(work);
  return true;
}

export const SOLD_OUT =
  "We've given out all the stickers for now. Thank you for answering.";

type Question = {
  name: string;
  label: string;
  type: "radio" | "checkbox" | "text" | "textarea";
  options: readonly string[];
  placeholder: string;
};

export const surveyQuestions: readonly Question[] = [
  {
    name: "discovery",
    label: "How did you first hear about bb?",
    type: "radio",
    options: [
      "A friend or coworker",
      "X (Twitter)",
      "Google or another search engine",
      "GitHub",
      "Hacker News",
      "Product Hunt",
      "A newsletter or blog post",
      "Reddit",
      "YouTube",
      "An AI assistant (ChatGPT, Claude, etc.)",
      "I don't remember",
      "Other",
    ],
    placeholder: "",
  },
  {
    name: "work",
    label: "Including you, how many people use bb where you work?",
    type: "radio",
    options: [
      "I don't use bb for work",
      "Just me",
      "2–4 people",
      "5 or more",
      "I'm not sure",
    ],
    placeholder: "",
  },
  {
    name: "company_size",
    label: "Approximately how many people work at your company or organization?",
    type: "radio",
    options: ["1–50", "51–200", "201–999", "1,000 or more"],
    placeholder: "",
  },
  {
    name: "role",
    label: "Which best describes your current role?",
    type: "radio",
    options: [
      "Developer or engineer",
      "Engineering manager",
      "Founder or executive",
      "Product manager",
      "Designer",
      "Data or business analyst",
      "Student",
      "Not currently working",
      "Other",
    ],
    placeholder: "",
  },
  {
    name: "love",
    label: "What do you value most about bb, and why?",
    type: "textarea",
    options: [],
    placeholder: "",
  },
  {
    name: "improve",
    label: "What would make bb better for you?",
    type: "textarea",
    options: [],
    placeholder: "",
  },
  {
    name: "team_improve",
    label: "What would make bb better for your team at work?",
    type: "textarea",
    options: [],
    placeholder: "",
  },
  {
    name: "team_adopt",
    label: "What would it take for others where you work to start using bb?",
    type: "textarea",
    options: [],
    placeholder: "",
  },
  {
    name: "community",
    label: "What would you most want from the bb community?",
    type: "checkbox",
    options: [
      "Meet other bb users, online or in person",
      "See how other people use bb",
      "Share what I've built and get feedback",
      "Get help when I'm stuck",
      "Build things with other bb users",
      "Hear what's on the roadmap and have a say in it",
      "Other",
    ],
    placeholder: "",
  },
  {
    name: "city",
    label: "What city do you live in or near?",
    type: "text",
    options: [],
    placeholder: "City, country",
  },
  {
    name: "meetup",
    label: "Would you come to a bb meetup near you?",
    type: "radio",
    options: ["Yes, and I'd help organize it", "Yes, I'd come", "Maybe", "No"],
    placeholder: "",
  },
];

export const OPTION_HINTS: Record<string, string> = {
  "Yes, and I'd help organize it": "We'll help with budget, merch and more.",
};

export type FormValues = Record<string, string[]>;
export type FormErrors = Record<string, string>;
export const surveyFields = [
  ...surveyQuestions.map((question) => question.name),
  "discovery_other",
  "role_other",
  "community_other",
  "email",
];

export function validateSurvey(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  for (const question of surveyQuestions) {
    if (!questionVisible(question.name, values)) continue;
    const selected = values[question.name] ?? [];
    if (question.type !== "checkbox" && selected.length > 1) {
      errors[question.name] = "Choose one answer.";
    } else if (selected.some((value) => value.length > 250)) {
      errors[question.name] = "Please shorten your answer.";
    } else if (
      question.options.length &&
      selected.some((value) => !question.options.includes(value))
    ) {
      errors[question.name] = "Choose one of the listed answers.";
    } else if (new Set(selected).size !== selected.length) {
      errors[question.name] = "Choose each answer only once.";
    } else if (
      question.name === "community" &&
      selected.length > COMMUNITY_MAX
    ) {
      errors.community = `Pick up to ${COMMUNITY_MAX}.`;
    } else if (!selected.some((value) => value.trim())) {
      errors[question.name] = "Please answer this question.";
    }
  }
  for (const name of [
    "discovery_other",
    "role_other",
    "community_other",
    "email",
  ]) {
    const selected = values[name] ?? [];
    if (selected.length > 1 || selected.some((value) => value.length > 250)) {
      errors[name] = "Please use one answer of up to 250 characters.";
    } else if (
      name.endsWith("_other") &&
      values[name.slice(0, -6)]?.includes("Other") &&
      !selected[0]?.trim()
    ) {
      errors[name] = "Please tell us what you mean by Other.";
    }
  }
  if (!values.email?.[0]?.trim()) errors.email = "Please enter your email.";
  else if (!z.email().safeParse(values.email[0]).success)
    errors.email = "Please enter a valid email.";
  return errors;
}

export function surveyAnswers(values: FormValues): FormValues {
  const answers: FormValues = {};
  for (const name of surveyFields) {
    if (!questionVisible(name, values)) continue;
    if (
      name.endsWith("_other") &&
      !values[name.slice(0, -6)]?.includes("Other")
    )
      continue;
    const selected = values[name]?.filter(Boolean) ?? [];
    if (selected.length) answers[name] = selected;
  }
  return answers;
}
