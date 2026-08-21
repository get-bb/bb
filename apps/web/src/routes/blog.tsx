import { ArrowRight01Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { POSTS } from "../blog/posts";
import { PostHeader, PostLede } from "../blog/post-body";
import { initAnalytics } from "../landing/analytics";
import {
  EmailSignup,
  focusSubscribeEmail,
  SUBSCRIBE_EMAIL_ID,
} from "../landing/cta";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import { unfurlMeta } from "../landing/site";
import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import landingCss from "../landing/landing.css?url";
import blogCss from "../blog/blog.css?url";

const PAGE_TITLE = "Blog — bb";
const PAGE_DESCRIPTION = "Notes on building the IDE that builds itself.";

export const Route = createFileRoute("/blog")({
  head: () => ({
    meta: [
      { title: PAGE_TITLE },
      { name: "description", content: PAGE_DESCRIPTION },
      ...unfurlMeta(PAGE_TITLE, PAGE_DESCRIPTION, "/blog"),
    ],
    links: [
      {
        rel: "preload",
        href: interWoff2,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "stylesheet", href: landingCss },
      { rel: "stylesheet", href: blogCss },
    ],
  }),
  component: BlogIndexRoute,
});

function BlogIndexRoute() {
  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <div className="wrap">
      <SiteNav current="blog" />

      <header className="page-head">
        <h1>Blog</h1>
        <p className="sub">{PAGE_DESCRIPTION}</p>
        <div className="meta-row">
          <a href={`#${SUBSCRIBE_EMAIL_ID}`} onClick={focusSubscribeEmail}>
            <HugeiconsIcon icon={Mail01Icon} className="ri" />
            Get new posts by email
          </a>
        </div>
      </header>

      <div className="post-index">
        {POSTS.map((post, index) => (
          <article className="post" key={post.slug}>
            <div className="post-body">
              <time className="date-pill" dateTime={post.dateIso}>
                {post.date}
              </time>
              <h2>
                <a href={`/blog/${post.slug}`}>{post.title}</a>
              </h2>
              <PostLede text={post.lede} />
              {index === 0 && post.cover ? (
                <a href={`/blog/${post.slug}`}>
                  <PostHeader src={post.cover.src} alt={post.cover.alt} />
                </a>
              ) : null}
              <a className="read-more" href={`/blog/${post.slug}`}>
                Read
                <HugeiconsIcon icon={ArrowRight01Icon} />
              </a>
            </div>
          </article>
        ))}
      </div>

      <section className="subscribe" id="subscribe">
        <h2 className="subscribe-title">Stay in the loop.</h2>
        <p>Get new posts in your inbox. No spam.</p>
        <EmailSignup placement="footer" />
      </section>

      <SiteFooter />
    </div>
  );
}
