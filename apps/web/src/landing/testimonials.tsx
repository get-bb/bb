import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon";
import NewTwitterIcon from "@hugeicons/core-free-icons/NewTwitterIcon";
import { HugeiconsIcon } from "@hugeicons/react";

import bornszteinAvatar from "../assets/testimonials/bruno-bornsztein.jpg";
import emreAvatar from "../assets/testimonials/emre.jpg";
import haisfieldAvatar from "../assets/testimonials/rob-haisfield.jpg";
import jingAvatar from "../assets/testimonials/jing.jpg";
import frostAvatar from "../assets/testimonials/steve-frost.jpg";
import swairAvatar from "../assets/testimonials/swair.jpg";
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
    author: "Hemanth Soni",
    byline: "hem.so",
    source: "blog",
    url: "https://hem.so/multiplexers",
    quote:
      "This is my current daily driver, primarily because of its incredibly robust and thoughtful plugin system. … I can’t recommend it enough.",
  },
  {
    author: "Jing",
    byline: "@Jingg_n_Tonic",
    avatar: jingAvatar,
    source: "x",
    url: "https://x.com/Jingg_n_Tonic/status/2095517767415795911",
    quote:
      "One of my favorite new apps… it’s the first app that lives up to the promise of personalized software.",
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
  {
    author: "emre",
    byline: "@bu7emba",
    avatar: emreAvatar,
    source: "x",
    url: "https://x.com/bu7emba/status/2114098680089444565",
    quote:
      "Loving the embedded generative UI and how much you can customize. The terminal was indeed a stopgap.",
  },
  {
    author: "Swair",
    byline: "@swairshah",
    avatar: swairAvatar,
    source: "x",
    url: "https://x.com/swairshah/status/2095643295020122216",
    quote: "Only good malleable software I’ve used in the LLM era is bb…",
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
