import { z } from "zod";

const TEAM_WORK_OPTIONS = ["2–5 people", "6–10 people", "More than 10"];
const SOLO_WORK_OPTIONS = ["Just me"];
const NOT_WORKING_ROLES = ["Student", "Not currently working"];
export function questionVisible(name: string, values: FormValues): boolean {
  const workShown = !NOT_WORKING_ROLES.includes(values.role?.[0] ?? "");
  if (name === "work") return workShown;
  const work = workShown ? (values.work?.[0] ?? "") : "";
  if (name === "company_size")
    return Boolean(work && work !== "I don't use bb for work");
  if (name === "team_improve") return TEAM_WORK_OPTIONS.includes(work);
  if (name === "team_adopt") return SOLO_WORK_OPTIONS.includes(work);
  return true;
}

type Question = {
  name: string;
  label: string;
  type: "radio" | "checkbox" | "text" | "textarea";
  options: readonly string[];
  placeholder?: string;
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
      "Freelancer, consultant or agency",
      "Student",
      "Not currently working",
      "Other",
    ],
  },
  {
    name: "work",
    label: "Including you, how many people use bb where you work?",
    type: "radio",
    options: [
      "I don't use bb for work",
      "Just me",
      "2–5 people",
      "6–10 people",
      "More than 10",
      "I'm not sure",
    ],
  },
  {
    name: "company_size",
    label:
      "Approximately how many people work at your company or organization?",
    type: "radio",
    options: ["1–50", "51–200", "201–999", "1,000 or more"],
  },
  {
    name: "love",
    label: "What do you value most about bb, and why?",
    type: "textarea",
    options: [],
  },
  {
    name: "improve",
    label: "What would make bb better for you?",
    type: "textarea",
    options: [],
  },
  {
    name: "team_improve",
    label: "What would make bb better for your team at work?",
    type: "textarea",
    options: [],
  },
  {
    name: "team_adopt",
    label: "What would it take for others where you work to start using bb?",
    type: "textarea",
    options: [],
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
  },
  {
    name: "research_call",
    label:
      "Would you be open to a short call to walk us through how you use bb?",
    type: "radio",
    options: ["Yes", "No"],
  },
];

export const formValues = z.object({}).catchall(z.array(z.string()));
export type FormValues = z.infer<typeof formValues>;
export type FormErrors = Record<string, string>;
export const surveyReply = z.object({
  result: z
    .object({
      duplicate: z.literal([true, false]),
      claimLink: z.string().nullable(),
      claimNote: z.string().nullable(),
      emailStatus: z.enum(["sent", "queued", "none"]),
    })
    .optional(),
  errors: z.object({}).catchall(z.string()).optional(),
  error: z.string().optional(),
});
export type SurveyReply = z.infer<typeof surveyReply>;
const DETAIL_FIELDS = [
  "discovery_other",
  "role_other",
  "community_other",
  "email",
];
export const surveyFields = [
  ...surveyQuestions.map((question) => question.name),
  ...DETAIL_FIELDS,
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
    } else if (!selected.some((value) => value.trim())) {
      errors[question.name] = "Please answer this question.";
    }
  }
  for (const name of DETAIL_FIELDS) {
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

export const SECTIONS: Record<string, string> = {
  discovery: "Getting to know you",
  love: "Your experience with bb",
  community: "What you'd like from the bb community",
};

export type SurveyOrder = Record<string, string[]>;

function shuffled(options: readonly string[], fixedLast: number): string[] {
  const result = options.slice(0, options.length - fixedLast);
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return [...result, ...options.slice(options.length - fixedLast)];
}

export function surveyOrder(): SurveyOrder {
  const options = (name: string) =>
    surveyQuestions.find((question) => question.name === name)!.options;
  return {
    discovery: shuffled(options("discovery"), 2),
    community: shuffled(options("community"), 1),
  };
}
