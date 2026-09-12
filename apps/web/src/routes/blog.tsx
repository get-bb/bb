import { ArrowRight01Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";

import { POSTS } from "../blog/posts";
import { PostHeader, PostLede } from "../blog/post-body";
import { useInitAnalytics } from "../landing/analytics";
import {
  focusSubscribeEmail,
  SUBSCRIBE_EMAIL_ID,
  SubscribeSection,
} from "../landing/cta";
import { pageMeta, siteHeadLinks } from "../landing/page-head";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import blogCss from "../blog/blog.css?url";

const PAGE_TITLE = "Blog — bb";
const PAGE_DESCRIPTION = "Notes on building the IDE that builds itself.";

export const Route = createFileRoute("/blog")({
  head: () => ({
    meta: pageMeta(PAGE_TITLE, PAGE_DESCRIPTION, "/blog"),
    links: siteHeadLinks(blogCss),
  }),
  component: BlogIndexRoute,
});

function BlogIndexRoute() {
  useInitAnalytics();

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

      <SubscribeSection
        id="subscribe"
        blurb="Get new posts in your inbox. No spam."
      />

      <SiteFooter />
    </div>
  );
}
