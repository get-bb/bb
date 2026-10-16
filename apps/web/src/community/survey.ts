export const SURVEY_TITLE = "bb Community Survey";
export const SURVEY_DESCRIPTION =
  "Help shape the bb community: tell us what you build, where you are, and which events and merch you'd enjoy. We already have hats, stickers, and enamel pins ready for events. We don't collect email addresses; sharing your Discord handle is optional.";

type Question = {
  name: string;
  label: string;
  type: "radio" | "checkbox" | "text" | "textarea";
  options: readonly string[];
  optional: boolean;
  other: boolean;
  help: string;
  maxChoices: number | null;
};

export const surveyQuestions: readonly Question[] = [
  {
    name: "role",
    label: "Which best describes your primary role?",
    type: "radio",
    options: [
      "Developer",
      "Product manager",
      "Designer",
      "Founder or business owner",
      "Analyst",
      "Student",
      "Prefer not to say",
      "Other",
    ],
    optional: false,
    other: true,
    help: "",
    maxChoices: null,
  },
  {
    name: "experience",
    label: "How would you describe your coding experience?",
    type: "radio",
    options: [
      "I have little or no coding experience",
      "I can read code and make small changes",
      "I can build software independently",
      "I develop software professionally",
      "Prefer not to say",
    ],
    optional: false,
    other: false,
    help: "",
    maxChoices: null,
  },
  {
    name: "tools",
    label: "Which coding agents or AI coding tools do you currently use?",
    type: "checkbox",
    options: [
      "Claude Code",
      "Codex",
      "Cursor",
      "GitHub Copilot",
      "Gemini CLI",
      "Windsurf",
      "None currently",
      "Prefer not to say",
      "Other",
    ],
    optional: false,
    other: true,
    help: "Select all that apply. If choosing 'None currently' or 'Prefer not to say', select only that option.",
    maxChoices: null,
  },
  {
    name: "building",
    label: "Do you mainly build on your own or with a team?",
    type: "radio",
    options: [
      "On my own",
      "With a team",
      "Both",
      "I'm not building yet",
      "Prefer not to say",
    ],
    optional: false,
    other: false,
    help: "",
    maxChoices: null,
  },
  {
    name: "location",
    label: "What city or metro area are you closest to? Include the country.",
    type: "text",
    options: [],
    optional: false,
    other: false,
    help: 'e.g. "SF Bay Area, US", "London, UK", "Lagos, Nigeria"',
    maxChoices: null,
  },
  {
    name: "travel",
    label: "How far would you travel for an in-person event?",
    type: "radio",
    options: [
      "Under 30 min",
      "Up to 1 hr",
      "A few hours",
      "I'd fly for the right event",
      "Online only",
    ],
    optional: false,
    other: false,
    help: "",
    maxChoices: null,
  },
  {
    name: "events",
    label: "Which would you attend?",
    type: "checkbox",
    options: [
      "In-person meetups or socials",
      "Hack nights / build sessions",
      "Demo days (show what you built)",
      "Workshops / tutorials",
      "Plugin or build challenges",
      "Hackathons",
      "Office hours / AMA with the team",
      "Livestreams (building with bb live)",
      "Talks from community members",
    ],
    optional: false,
    other: false,
    help: "",
    maxChoices: null,
  },
  {
    name: "format",
    label: "Online or in person?",
    type: "radio",
    options: ["Mostly online", "Mostly in person", "Both equally"],
    optional: false,
    other: false,
    help: "",
    maxChoices: null,
  },
  {
    name: "frequency",
    label: "How often?",
    type: "radio",
    options: [
      "Weekly",
      "Every 2 weeks",
      "Monthly",
      "Quarterly",
      "Just big occasional events",
    ],
    optional: false,
    other: false,
    help: "",
    maxChoices: null,
  },
  {
    name: "help",
    label: "Would you help make events happen?",
    type: "checkbox",
    options: [
      "Host a meetup in my city",
      "Give a demo or talk",
      "Help organize",
      "Just attend",
    ],
    optional: false,
    other: false,
    help: "",
    maxChoices: null,
  },
  {
    name: "merch",
    label:
      "We're bringing hats, stickers, and enamel pins to events. What should we make next? (pick up to 3)",
    type: "checkbox",
    options: [
      "T-shirt",
      "Hoodie",
      "Tote bag",
      "Mug",
      "Socks",
      "Desk mat",
      "Notebook",
      "Other",
    ],
    optional: false,
    other: true,
    help: "",
    maxChoices: 3,
  },
  {
    name: "style",
    label: "What style do you like?",
    type: "radio",
    options: [
      "Minimal / subtle logo",
      "Bold / graphic",
      "Inside jokes / community references",
      "Limited drops tied to events",
    ],
    optional: false,
    other: false,
    help: "",
    maxChoices: null,
  },
  {
    name: "sticker",
    label: "Want a sticker or pin even if there's no event near you?",
    type: "radio",
    options: ["Yes", "No"],
    optional: true,
    other: false,
    help: "",
    maxChoices: null,
  },
  {
    name: "feedback",
    label: "Anything else you'd want from the community?",
    type: "textarea",
    options: [],
    optional: true,
    other: false,
    help: "",
    maxChoices: null,
  },
  {
    name: "discord",
    label:
      "Discord handle, if you're open to follow-up about hosting or events",
    type: "text",
    options: [],
    optional: true,
    other: false,
    help: "",
    maxChoices: null,
  },
];

export type FormValues = Record<string, string[]>;
export type FormErrors = Record<string, string>;

export function validateSurvey(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  for (const question of surveyQuestions) {
    const selected = values[question.name] ?? [];
    if (
      !question.optional &&
      (selected.length === 0 || selected.every((v) => !v.trim()))
    ) {
      errors[question.name] = "Please answer this question.";
    } else if (question.type !== "checkbox" && selected.length > 1) {
      errors[question.name] = "Choose one answer.";
    } else if (
      selected.some(
        (v) => v.length > (question.type === "textarea" ? 2000 : 250),
      )
    ) {
      errors[question.name] = "Please shorten your answer.";
    } else if (
      question.options.length &&
      selected.some((v) => !question.options.includes(v))
    ) {
      errors[question.name] = "Choose one of the listed answers.";
    } else if (new Set(selected).size !== selected.length) {
      errors[question.name] = "Choose each answer only once.";
    } else if (
      question.maxChoices !== null &&
      selected.length > question.maxChoices
    ) {
      errors[question.name] = "Pick up to 3";
    } else if (
      question.name === "tools" &&
      selected.length > 1 &&
      selected.some((v) => v === "None currently" || v === "Prefer not to say")
    ) {
      errors[question.name] = question.help;
    }
    if (question.other && selected.includes("Other")) {
      const other = values[`${question.name}_other`] ?? [];
      if (other.length !== 1 || !other[0]?.trim() || other[0].length > 250) {
        errors[question.name] =
          "Please write in your other answer (up to 250 characters).";
      }
    }
  }
  return errors;
}
