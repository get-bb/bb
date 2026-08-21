import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect } from "react";

import { PostBlocks, PostHeader, PostLede } from "../blog/post-body";
import { getPost } from "../blog/posts";
import { stripMarkdown } from "../blog/parse-post";
import { initAnalytics } from "../landing/analytics";
import { EmailSignup } from "../landing/cta";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import { unfurlMeta } from "../landing/site";
import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import landingCss from "../landing/landing.css?url";
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
      meta: [
        { title },
        { name: "description", content: description },
        ...unfurlMeta(title, description, `/blog/${post.slug}`),
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
    };
  },
  component: BlogPostRoute,
});

function BlogPostRoute() {
  const { post } = Route.useLoaderData();
  useEffect(() => {
    initAnalytics();
  }, []);

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

      <section className="subscribe" id="subscribe">
        <h2 className="subscribe-title">Stay in the loop.</h2>
        <p>Get new posts in your inbox. No spam.</p>
        <EmailSignup placement="footer" />
      </section>

      <SiteFooter />
    </div>
  );
}
