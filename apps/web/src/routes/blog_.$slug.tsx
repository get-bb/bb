import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { PostBlocks, PostHeader, PostLede } from "../blog/post-body";
import { getPost } from "../blog/posts";
import { stripMarkdown } from "../blog/parse-post";
import { useInitAnalytics } from "../landing/analytics";
import { SubscribeSection } from "../landing/cta";
import { pageMeta, siteHeadLinks } from "../landing/page-head";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import blogCss from "../blog/blog.css?url";

export const Route = createFileRoute("/blog_/$slug")({
  loader: ({ params }) => {
    const post = getPost(params.slug);
    if (!post) {
      throw notFound();
    }
    return { post };
  },
  head: ({ loaderData }) => {
    const post = loaderData?.post;
    if (!post) {
      return { meta: [{ title: "Blog — bb" }] };
    }
    const description = stripMarkdown(post.lede);
    const title = `${post.title} — bb`;
    return {
      meta: pageMeta(title, description, `/blog/${post.slug}`),
      links: siteHeadLinks(blogCss),
    };
  },
  component: BlogPostRoute,
});

function BlogPostRoute() {
  const { post } = Route.useLoaderData();
  useInitAnalytics();

  return (
    <div className="wrap">
      <SiteNav current="blog" />

      <div className="article-head">
        <a className="back-link" href="/blog">
          <HugeiconsIcon icon={ArrowLeft01Icon} className="ri" />
          Blog
        </a>
      </div>

      <article className="post article">
        <div className="post-body">
          <time className="date-pill" dateTime={post.dateIso}>
            {post.date}
          </time>
          <h1>{post.title}</h1>
          {post.cover ? (
            <PostHeader src={post.cover.src} alt={post.cover.alt} lightbox />
          ) : null}
          <PostLede text={post.lede} />
          <PostBlocks post={post} />
        </div>
      </article>

      <SubscribeSection
        id="subscribe"
        blurb="Get new posts in your inbox. No spam."
      />

      <SiteFooter />
    </div>
  );
}
