import type { ReactNode } from "react";
import Link from "next/link";
import type { PressConfig } from "../config.js";
import { formatDate, type Post } from "../cms.js";
import { renderMarkdown } from "../markdown.js";
import { initials, readingMinutes } from "../reading-time.js";
import { proseCss } from "../theme.js";

/*
 * The post page, shared by the static screen and the preview screen.
 *
 * It is its own component because reading `searchParams` forces a route to render dynamically,
 * and a site built with `output: "export"` is refused outright for it. Preview needs the query
 * string; a published post does not. Splitting the fetch from the render is what lets one set of
 * markup serve a static site and a server-rendered one.
 *
 * Every link is built from `config.routes`, and every colour, face and radius from `config.theme`,
 * so a site that mounts posts at /writing gets /writing links here and in the feed, and a site
 * with its own palette gets its own palette without touching this file.
 *
 * The styles are inline rather than classes against `barakopress/styles.css`. That stylesheet is
 * opt-in, barakocms.com never imported it, and the result was this screen rendering as an
 * unstyled article at x=0 on a blank page, which is why that site stopped using the screen at all.
 * A screen whose look depends on an import the consumer might not make is a screen that renders
 * broken for somebody. The one exception is the rendered body, which is a string of HTML that
 * inline styles cannot reach, so it gets a generated stylesheet built from the same tokens.
 */

/** Scopes the generated body stylesheet. Prefixed so it cannot collide with a consumer's own `.prose`. */
const PROSE_CLASS = "bp-prose";

export interface PostViewProps {
    config: PressConfig;
    post: Post;
    preview?: boolean;
    /*
     * Three slots, and the reason there are exactly three.
     *
     * A brand mark behind the header is the consumer's, not the engine's: barakocms.com has a bean
     * and a client site has something else or nothing. A post that needs a section the reading
     * column cannot hold needs somewhere wide to put it, and a post that ends in a call to action
     * needs the foot of the column.
     *
     * What these are not is a way to compose a post out of arbitrary sections. Anything that has
     * to sit between two paragraphs of a body belongs to the block model, issue #6, because only
     * the body knows where it goes.
     */
    headerBackdrop?: ReactNode;
    beforeBody?: ReactNode;
    afterBody?: ReactNode;
}

export function PostView({
    config,
    post,
    preview = false,
    headerBackdrop,
    beforeBody,
    afterBody,
}: PostViewProps) {
    const t = config.theme;
    const c = t.colors;
    const gutter = t.layout.gutter;

    const backHref = config.routes.post || "/";
    // "/writing" reads as WRITING. The route is the only thing that knows what the index is called,
    // and asking for a label as well would be a second place to keep the same word.
    const backLabel = backHref.split("/").filter(Boolean).pop() ?? "Home";

    const minutes = readingMinutes(post.body);
    const monogram = post.author ? initials(post.author.name) : "";

    const band = { padding: `0 ${gutter}` } as const;
    const meta = { fontFamily: t.fonts.mono, fontSize: "12.5px", color: c.muted } as const;

    return (
        <div style={{ background: c.pageBg, color: c.ink, fontFamily: t.fonts.body }}>
            <style dangerouslySetInnerHTML={{ __html: proseCss(t, PROSE_CLASS) }} />

            {preview && (
                <div style={{ ...band, paddingTop: "16px", background: c.surface }}>
                    <div
                        style={{
                            maxWidth: t.layout.prose,
                            margin: "0 auto",
                            padding: "14px 18px",
                            borderRadius: t.radii.panel,
                            background: c.accentTint,
                            border: `1px solid ${c.accentTintBorder}`,
                            color: c.accentInk,
                            fontSize: "14px",
                            lineHeight: 1.6,
                        }}
                    >
                        Preview. This is how the post will look. It is not published, and it is
                        served uncached so nothing here reaches another reader.
                    </div>
                </div>
            )}

            <header
                style={{
                    ...band,
                    paddingTop: "64px",
                    paddingBottom: "56px",
                    background: c.surface,
                    borderBottom: `1px solid ${c.hairline}`,
                    position: "relative",
                    overflow: "hidden",
                }}
            >
                {headerBackdrop && (
                    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden>
                        {headerBackdrop}
                    </div>
                )}

                <div style={{ maxWidth: t.layout.prose, margin: "0 auto", position: "relative" }}>
                    <Link
                        href={backHref}
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "8px",
                            fontFamily: t.fonts.mono,
                            fontSize: "11.5px",
                            letterSpacing: ".14em",
                            textTransform: "uppercase",
                            color: c.muted,
                        }}
                    >
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden>
                            <path d="M7.2 2.3 1.5 8l5.7 5.7 1.1-1.1L4.7 8.8H14.5V7.2H4.7l3.6-3.8z" />
                        </svg>
                        {backLabel}
                    </Link>

                    <h1
                        style={{
                            margin: "22px 0 0",
                            fontFamily: t.fonts.heading,
                            fontWeight: 600,
                            fontSize: "clamp(34px, 4.6vw, 58px)",
                            lineHeight: 1.06,
                            letterSpacing: "-.038em",
                            color: c.ink,
                            textWrap: "balance",
                        }}
                    >
                        {post.title}
                    </h1>

                    {post.excerpt && (
                        <p
                            style={{
                                margin: "24px 0 0",
                                maxWidth: "60ch",
                                fontSize: "19.5px",
                                lineHeight: 1.6,
                                color: c.secondaryInk,
                                textWrap: "pretty",
                            }}
                        >
                            {post.excerpt}
                        </p>
                    )}

                    <div
                        style={{
                            marginTop: "30px",
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: "10px 26px",
                            fontSize: "14px",
                            color: c.muted,
                        }}
                    >
                        {post.author && (
                            <span style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                                <span
                                    aria-hidden
                                    style={{
                                        width: "28px",
                                        height: "28px",
                                        flexShrink: 0,
                                        borderRadius: t.radii.pill,
                                        background: c.accentTint,
                                        color: c.accentInk,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontFamily: t.fonts.heading,
                                        fontSize: "12px",
                                        fontWeight: 600,
                                    }}
                                >
                                    {monogram}
                                </span>
                                by{" "}
                                {config.routes.author ? (
                                    <Link
                                        href={`${config.routes.author}/${post.author.slug}`}
                                        style={{ color: c.ink, fontWeight: 600 }}
                                    >
                                        {post.author.name}
                                    </Link>
                                ) : (
                                    <span style={{ color: c.ink, fontWeight: 600 }}>
                                        {post.author.name}
                                    </span>
                                )}
                            </span>
                        )}

                        {post.publishedAt && (
                            <time dateTime={post.publishedAt} style={meta}>
                                {formatDate(config, post.publishedAt)}
                            </time>
                        )}

                        <span style={meta}>{minutes} min read</span>

                        {post.category && config.routes.category && (
                            <Link href={`${config.routes.category}/${post.category.slug}`} style={meta}>
                                {post.category.name}
                            </Link>
                        )}

                        {post.tags.map((tag) => (
                            <span
                                key={tag}
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    padding: "5px 11px",
                                    borderRadius: t.radii.pill,
                                    background: c.accentTint,
                                    color: c.accentInk,
                                    fontFamily: t.fonts.mono,
                                    fontSize: "11px",
                                    letterSpacing: ".1em",
                                    textTransform: "uppercase",
                                }}
                            >
                                {tag}
                            </span>
                        ))}
                    </div>
                </div>
            </header>

            {beforeBody && (
                <section style={{ ...band, paddingTop: "56px", paddingBottom: "8px" }}>
                    <div style={{ maxWidth: t.layout.wide, margin: "0 auto" }}>{beforeBody}</div>
                </section>
            )}

            <article style={{ ...band, paddingTop: "48px", paddingBottom: "72px" }}>
                <div style={{ maxWidth: t.layout.prose, margin: "0 auto" }}>
                    {post.coverImage && (
                        // Not next/image: the CMS resizes on request with ?w=, so the optimiser
                        // would be a second resizer in front of the first.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={post.coverImage}
                            alt={post.coverImageAlt ?? ""}
                            style={{
                                width: "100%",
                                marginBottom: "36px",
                                borderRadius: t.radii.panel,
                                border: `1px solid ${c.hairline}`,
                            }}
                        />
                    )}

                    <div
                        className={PROSE_CLASS}
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body) }}
                    />

                    {afterBody}
                </div>
            </article>
        </div>
    );
}
