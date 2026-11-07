import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon";
import NewTwitterIcon from "@hugeicons/core-free-icons/NewTwitterIcon";
import { HugeiconsIcon } from "@hugeicons/react";

import goyalAvatar from "../assets/testimonials/alana-goyal.jpg";
import banesAvatar from "../assets/testimonials/chris-banes.jpg";
import durukAvatar from "../assets/testimonials/can-duruk.jpg";
import ishanAvatar from "../assets/testimonials/ishan.jpg";
import bornszteinAvatar from "../assets/testimonials/bruno-bornsztein.jpg";
import lutkeAvatar from "../assets/testimonials/tobi-lutke.jpg";
import ondrejAvatar from "../assets/testimonials/david-ondrej.jpg";
import haisfieldAvatar from "../assets/testimonials/rob-haisfield.jpg";
import sunartoAvatar from "../assets/testimonials/scott-sunarto.jpg";
import swairAvatar from "../assets/testimonials/swair.jpg";
import tossellAvatar from "../assets/testimonials/ben-tossell.jpg";
import { trackLandingEvent } from "./analytics";

export type TestimonialSource = "x" | "github" | "blog";

type Testimonial = {
  author: string;
  byline: string;
  avatar?: string;
  source: TestimonialSource;
  url: string;
  quote: string;
};

const SOURCE_ICON = {
  x: { icon: NewTwitterIcon, label: "X" },
  github: { icon: GithubIcon, label: "GitHub" },
  blog: { icon: Link01Icon, label: "Blog post" },
} as const;

const TESTIMONIALS: readonly Testimonial[] = [
  {
    author: "Ben Tossell",
    byline: "@bentossell",
    avatar: tossellAvatar,
    source: "x",
    url: "https://x.com/bentossell/status/2085300851824787550",
    quote: "best new app i’ve tried in a while\n\nlikely my new default",
  },
  {
    author: "Tobi Lütke",
    byline: "@tobi",
    avatar: lutkeAvatar,
    source: "x",
    url: "https://x.com/tobi/status/2111930824035836020",
    quote: "bb is really great",
  },
  {
    author: "Alana Goyal",
    byline: "@alanaagoyal",
    avatar: goyalAvatar,
    source: "x",
    url: "https://x.com/alanaagoyal/status/2085121395361828929",
    quote:
      "truly one of the craziest pieces of software i've used in the past six months",
  },
  {
    author: "Rob Haisfield",
    byline: "@RobertHaisfield",
    avatar: haisfieldAvatar,
    source: "x",
    url: "https://x.com/RobertHaisfield/status/2118133290460995727",
    quote:
      "bb is the best agent orchestrator out there, for software engineers, product managers, operations, literally anyone who works heavily with agents can trivially customize it to their needs and workflows and it comes with my HIGHEST recommendations.",
  },
  {
    author: "David Ondrej",
    byline: "@DavidOndrej1",
    avatar: ondrejAvatar,
    source: "x",
    url: "https://x.com/DavidOndrej1/status/2090488406228840865",
    quote:
      "bb has the best GUI for Agentic Engineering right now\n\nchange my mind",
  },
  {
    author: "Chris Banes",
    byline: "@chrisbanes",
    avatar: banesAvatar,
    source: "x",
    url: "https://x.com/chrisbanes/status/2095501731530481784",
    quote:
      "After trying out `bb` for a few days, I might have just replaced the ChatGPT app.\n\nThe ability to extend it with easy-to-create plugins is just :chef_kiss:",
  },
  {
    author: "Scott Sunarto",
    byline: "@smsunarto",
    avatar: sunartoAvatar,
    source: "x",
    url: "https://x.com/smsunarto/status/2087277136952578498",
    quote:
      "i’ve been using bb for the past week, and I have to say that no AI dev tool have stick with me and became my daily driver as quickly as bb",
  },
  {
    author: "Can Duruk",
    byline: "@can",
    avatar: durukAvatar,
    source: "x",
    url: "https://x.com/can/status/2085579967833002246",
    quote:
      "this is the most interesting agentic dev environment ive used so far.",
  },
  {
    author: "Hemanth Soni",
    byline: "hem.so",
    source: "blog",
    url: "https://hem.so/multiplexers",
    quote:
      "This is my current daily driver, primarily because of its incredibly robust and thoughtful plugin system. … It’s a novel mental model for extensibility, and I can’t recommend it enough.",
  },
  {
    author: "Swair",
    byline: "@swairshah",
    avatar: swairAvatar,
    source: "x",
    url: "https://x.com/swairshah/status/2095643295020122216",
    quote:
      "Only good malleable software I've used in the LLM era is bb… So good I could get the codex voice integration to be much more powerful in bb than in codex.",
  },
  {
    author: "Bruno Bornsztein",
    byline: "@brunotorious",
    avatar: bornszteinAvatar,
    source: "x",
    url: "https://x.com/brunotorious/status/2098491369895428369",
    quote:
      "Holy shit @get_bb_app is really good.\n\nAnd I've tried everything. claude, codex, t3, delta, tembo and any number of others (including building my own @taskyoudev TUI which is still my go to).\n\nThis is the first thing I've seen in a while that really blows me away.",
  },
  {
    author: "ishan",
    byline: "@0xishand",
    avatar: ishanAvatar,
    source: "x",
    url: "https://x.com/0xishand/status/2098304763368767697",
    quote:
      "bb is one of the most impressive tools I've used in a very long time. With a few prompts you can completely generate your own in-IDE tooling for anything. This is exactly how adaptive UIs should act and feel.",
  },
];

const COLUMNS: readonly (readonly string[])[] = [
  ["Ben Tossell", "Hemanth Soni", "Swair"],
  ["Tobi Lütke", "Scott Sunarto", "Bruno Bornsztein"],
  ["Alana Goyal", "Chris Banes", "ishan"],
  ["Rob Haisfield", "David Ondrej", "Can Duruk"],
];

function testimonialBy(author: string): Testimonial {
  const found = TESTIMONIALS.find((t) => t.author === author);
  if (!found) {
    throw new Error(`No testimonial for ${author}`);
  }
  return found;
}

const COLUMN_CARDS = COLUMNS.map((column) => column.map(testimonialBy));

function QuoteText({ text }: { text: string }) {
  return text
    .split("`")
    .map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function TestimonialCard({ t }: { t: Testimonial }) {
  const source = SOURCE_ICON[t.source];
  return (
    <li className="tm-item">
      <div className="tm-card">
        <a
          className="tm-card-link"
          href={t.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${t.author}: read the post`}
          onClick={() =>
            trackLandingEvent({
              name: "landing_testimonial_clicked",
              properties: { source: t.source },
            })
          }
        />
        <blockquote className="tm-quote">
          <QuoteText text={t.quote} />
        </blockquote>
        <span className="tm-author">
          {t.avatar ? (
            <img className="tm-avatar" src={t.avatar} alt="" loading="lazy" />
          ) : (
            <span className="tm-avatar tm-initials" aria-hidden="true">
              {initials(t.author)}
            </span>
          )}
          <span className="tm-who">
            <span className="tm-name">{t.author}</span>
            <span className="tm-byline">{t.byline}</span>
          </span>
          <HugeiconsIcon
            icon={source.icon}
            className="tm-source"
            role="img"
            aria-label={source.label}
          />
        </span>
      </div>
    </li>
  );
}

export function Testimonials() {
  return (
    <section
      className="testimonials tm-phone-pages"
      aria-labelledby="testimonials-title"
      data-reveal
      data-section="testimonials"
    >
      <h2 id="testimonials-title" className="sec-title">
        A daily driver for builders.
      </h2>
      <div className="tm-grid">
        {[COLUMN_CARDS.slice(0, 2), COLUMN_CARDS.slice(2)].map((pair, p) => (
          <div className="tm-pair" key={p}>
            {pair.map((column) => (
              <ul className="tm-col" key={column[0].url}>
                {column.map((t) => (
                  <TestimonialCard key={t.url} t={t} />
                ))}
              </ul>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
