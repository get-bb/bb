export type TweetMedia =
  | { kind: "image"; src: string; width: number; height: number }
  | {
      kind: "video";
      src: string;
      poster: string;
      width: number;
      height: number;
    };

export type Tweet = {
  id: string;
  href: string;
  name: string;
  handle: string;
  avatarSrc: string;
  text: string;
  dateIso: string;
  date: string;
  media?: TweetMedia;
};

export const TWEETS: Record<string, Tweet> = {
  "2084345751266857079": {
    id: "2084345751266857079",
    href: "https://x.com/brian_lovin/status/2084345751266857079",
    name: "Brian Lovin",
    handle: "brian_lovin",
    avatarSrc: "/blog/tweets/brian-lovin.jpg",
    text: '"Did I cook??"\n\n[picture of generic saas app sidebar]',
    dateIso: "2026-08-03",
    date: "August 3, 2026",
  },
  "2083215357872120216": {
    id: "2083215357872120216",
    href: "https://x.com/sawyerhood/status/2083215357872120216",
    name: "Sawyer Hood",
    handle: "sawyerhood",
    avatarSrc: "/blog/tweets/sawyerhood.jpg",
    text: "have been playing with doing tiling window management for agents conversations. it is a little too unhinged but i think there is something here.",
    dateIso: "2026-07-31",
    date: "July 31, 2026",
    media: {
      kind: "video",
      src: "/blog/tweets/tiling.mp4",
      poster: "/blog/tweets/tiling-poster.jpg",
      width: 1228,
      height: 720,
    },
  },
};

export function getTweet(id: string): Tweet | undefined {
  return TWEETS[id];
}
