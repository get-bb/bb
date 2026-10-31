import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon";
import NewTwitterIcon from "@hugeicons/core-free-icons/NewTwitterIcon";
import { HugeiconsIcon } from "@hugeicons/react";

import banesAvatar from "../assets/testimonials/chris-banes.jpg";
import bornszteinAvatar from "../assets/testimonials/bruno-bornsztein.jpg";
import ajiboyeAvatar from "../assets/testimonials/timi-ajiboye.jpg";
import haisfieldAvatar from "../assets/testimonials/rob-haisfield.jpg";
import lutkeAvatar from "../assets/testimonials/tobi-lutke.jpg";
import ondrejAvatar from "../assets/testimonials/david-ondrej.jpg";
import frostAvatar from "../assets/testimonials/steve-frost.jpg";
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
  wide?: boolean;
};

const SOURCE_ICON = {
  x: { icon: NewTwitterIcon, label: "X" },
  github: { icon: GithubIcon, label: "GitHub" },
  blog: { icon: Link01Icon, label: "Blog post" },
} as const;

const TESTIMONIALS: readonly Testimonial[] = [
  {
    author: "Tobi Lütke",
    byline: "CEO, Shopify",
    avatar: lutkeAvatar,
    source: "x",
    url: "https://x.com/tobi/status/2104898204135297252",
    quote: "I think it’s really really good, too! Use it daily.",
  },
  {
    author: "Ben Tossell",
    byline: "Founder, Ben’s Bites",
    avatar: tossellAvatar,
    source: "x",
    url: "https://x.com/bentossell/status/2085300851824787550",
    quote: "best new app i’ve tried in a while\n\nlikely my new default",
  },
  {
    author: "David Ondrej",
    byline: "@DavidOndrej1",
    avatar: ondrejAvatar,
    source: "x",
    url: "https://x.com/DavidOndrej1/status/2090488406228840865",
    quote: "bb has the best GUI for Agentic Engineering right now",
  },
  {
    author: "Chris Banes",
    byline: "@chrisbanes",
    avatar: banesAvatar,
    source: "x",
    url: "https://x.com/chrisbanes/status/2095501731530481784",
    quote:
      "After trying out bb for a few days, I might have just replaced the ChatGPT app.",
  },
  {
    author: "Scott Sunarto",
    byline: "CEO, Argus Labs",
    avatar: sunartoAvatar,
    source: "x",
    url: "https://x.com/smsunarto/status/2087277136952578498",
    quote:
      "…no AI dev tool … became my daily driver as quickly as bb",
  },
  {
    author: "Timi Ajiboye",
    byline: "@timigod",
    avatar: ajiboyeAvatar,
    source: "x",
    url: "https://x.com/timigod/status/2087664204744450515",
    quote: "It’s just been 15 mins but it feels like bb might be the one.",
  },
  {
    author: "Hemanth Soni",
    byline: "hem.so",
    source: "blog",
    url: "https://hem.so/multiplexers",
    quote:
      "This is my current daily driver, primarily because of its incredibly robust and thoughtful plugin system. … I can’t recommend it enough.",
  },
  {
    author: "Swair",
    byline: "@swairshah",
    avatar: swairAvatar,
    source: "x",
    url: "https://x.com/swairshah/status/2095643295020122216",
    quote: "Only good malleable software I’ve used in the LLM era is bb…",
  },
  {
    author: "Bruno Bornsztein",
    byline: "@brunotorious",
    avatar: bornszteinAvatar,
    source: "x",
    url: "https://x.com/brunotorious/status/2114326460852842598",
    quote:
      "…my daily driver… open source, multi provider, natively multi-machine and remote, and extensible.",
  },
  {
    author: "Steve Frost",
    byline: "GitHub discussion",
    avatar: frostAvatar,
    source: "github",
    url: "https://github.com/get-bb/bb/discussions/5562",
    quote:
      "How is bb everything I’ve ever wanted from codex? Customizable like pi, first-class css overrides… I never want this to end.",
  },
  {
    author: "Rob Haisfield",
    byline: "@RobertHaisfield",
    avatar: haisfieldAvatar,
    source: "x",
    url: "https://x.com/RobertHaisfield/status/2110471735573401921",
    quote:
      "I use child threads… and I highly recommend them… child threads are more like teammates that build up their own context over many tasks and collaborate",
    wide: true,
  },
];

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
    <li className={`tm-item${t.wide ? " tm-wide" : ""}`}>
      <a
        className="tm-card"
        href={t.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() =>
          trackLandingEvent({
            name: "landing_testimonial_clicked",
            properties: { source: t.source },
          })
        }
      >
        <blockquote className="tm-quote">{t.quote}</blockquote>
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
      </a>
    </li>
  );
}

export function Testimonials() {
  return (
    <section
      className="testimonials"
      aria-labelledby="testimonials-title"
      data-reveal
      data-section="testimonials"
    >
      <h2 id="testimonials-title" className="sec-title">
        A daily driver for builders.
      </h2>
      <ul className="tm-grid">
        {TESTIMONIALS.map((t) => (
          <TestimonialCard key={t.url} t={t} />
        ))}
      </ul>
    </section>
  );
}
