import type { ReactNode } from "react";
import Link from "next/link";
import { Asset, renderProse } from "../assets.js";
import type { PressConfig } from "../config.js";
import { formatDate } from "../cms.js";
import { collectionOf, defaultByline, type Item } from "../collections.js";
import { initials, readingMinutes } from "../reading-time.js";
import { proseCss, relatedCss } from "../theme.js";

/*
 * The article layout: a collection item drawn as a reading column.
 *
 * This is the markup the blog post page has always had, and it is here rather than in a blog file
 * because what it does is not blog-shaped (#75). A reading column, a byline, a read time and a band
 * of neighbours are what any long-form collection wants: a law firm's briefings, a newsroom's
 * features, a manual's pages. A collection asks for it with `layout: "article"`, and the blog's post
 * collection is one that does.
 *
 * What stays blog-only is what a post is composed of rather than how it is drawn: the three slots
 * below, which exist for the blog screens and for a consumer assembling its own post page.
 *
 * It is its own component because reading `searchParams` forces a route to render dynamically,
 * and a site built with `output: "export"` is refused outright for it. Preview needs the query
 * string; a published post does not. Splitting the fetch from the render is what lets one set of
 * markup serve a static site and a server-rendered one.
 *
 * Every link is built from the collection's own route and its references' routes, and every colour,
 * face and radius from `config.theme`, so a site that mounts posts at /writing gets /writing links
 * here and in the feed, and a site with its own palette gets its own palette without touching this
 * file.
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
/** Same reason as PROSE_CLASS: a hover rule needs a selector, and a style attribute has none. */
const RELATED_CLASS = "bp-related-card";

/**
 * One card in the band under an article.
 *
 * `score` is what the semantic band has and a list of neighbours read any other way does not, so it
 * is optional and the chip is drawn only where there is a number to put in it.
 */
export interface ArticleRelated {
    slug: string;
    title: string;
    score?: number;
    date?: string;
    summary?: string;
}

export interface ArticleViewProps {
    config: PressConfig;
    item: Item;
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
    /*
     * Computed by the caller, passed in rather than fetched here, because this component also
     * serves the preview screen and a draft has no business warming a shared cache. An empty list
     * renders no band at all: no heading, no empty state. A site whose CMS has no AI module gets
     * an empty list every time and never sees that this feature exists, which is the point.
     */
    related?: ArticleRelated[];
    /** Drawn under the band: previous and next, an edit link, whatever the caller puts there. */
    footer?: ReactNode;
}

export function ArticleView({
    config,
    item,
    preview = false,
    headerBackdrop,
    beforeBody,
    afterBody,
    related = [],
    footer,
}: ArticleViewProps) {
    const t = config.theme;
    const c = t.colors;
    const labels = config.labels;
    const gutter = t.layout.gutter;

    const col = collectionOf(config, item.collection);
    const route = col?.route ?? "";
    const backHref = route || "/";
    // "/writing" reads as WRITING. The route is the only thing that knows what the index is called,
    // and asking for a label as well would be a second place to keep the same word.
    const backLabel = backHref.split("/").filter(Boolean).pop() ?? labels.home;

    const minutes = readingMinutes(item.body);
    /*
     * The byline is the collection's first reference, and the rest are plain links after the date.
     *
     * A long-form item has one relationship that reads as authorship and any number that read as
     * filing, and the collection already puts its references in the order a card shows them. The blog
     * declares Author before Category, so a post is drawn exactly as it always was, and a newsroom
     * whose first reference is `Photographer` gets a byline without configuring a second thing.
     */
    const shown = Object.entries(col?.references ?? {}).flatMap(([field, ref]) => {
        const target = item.refs[field];
        const to = collectionOf(config, ref.collection)?.route;
        return target ? [{ field, name: target.name, href: to ? `${to}/${target.slug}` : undefined }] : [];
    });
    const unsigned = defaultByline(config, col, item);
    if (unsigned) shown.unshift({ field: "", name: unsigned.name, href: undefined });
    const [byline, ...filed] = shown;
    const monogram = byline ? initials(byline.name) : "";

    const band = { padding: `0 ${gutter}` } as const;
    const meta = { fontFamily: t.fonts.mono, fontSize: "12.5px", color: c.muted } as const;

    return (
        <div style={{ background: c.pageBg, color: c.ink, fontFamily: t.fonts.body }}>
            <style
                dangerouslySetInnerHTML={{
                    __html: proseCss(t, PROSE_CLASS) + relatedCss(t, RELATED_CLASS),
                }}
            />

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
                        {labels.preview}
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
                        {item.title}
                    </h1>

                    {item.summary && (
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
                            {item.summary}
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
                        {byline && (
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
                                {labels.by}{" "}
                                {byline.href ? (
                                    <Link href={byline.href} style={{ color: c.ink, fontWeight: 600 }}>
                                        {byline.name}
                                    </Link>
                                ) : (
                                    <span style={{ color: c.ink, fontWeight: 600 }}>{byline.name}</span>
                                )}
                            </span>
                        )}

                        {item.date && (
                            <time dateTime={item.date} style={meta}>
                                {formatDate(config, item.date)}
                            </time>
                        )}

                        <span style={meta}>
                            {minutes} {labels.minRead}
                        </span>

                        {filed.map(
                            (f) =>
                                f.href && (
                                    <Link key={f.field} href={f.href} style={meta}>
                                        {f.name}
                                    </Link>
                                ),
                        )}

                        {item.tags.map((tag) => (
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
                    {item.image && (
                        // Not next/image: the CMS resizes on request with ?w=, so the optimiser
                        // would be a second resizer in front of the first.
                        <Asset
                            src={item.image}
                            alt={item.imageAlt ?? ""}
                            theme={t}
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
                        dangerouslySetInnerHTML={{ __html: renderProse(item.body, t) }}
                    />

                    {item.url && (
                        <p style={{ margin: "28px 0 0", fontSize: "14px" }}>
                            <a href={item.url} rel="noopener noreferrer" style={{ color: c.accent }}>
                                {item.url}
                            </a>
                        </p>
                    )}

                    {afterBody}
                </div>
            </article>

            {related.length > 0 && (
                <section
                    style={{
                        ...band,
                        paddingTop: "52px",
                        paddingBottom: "60px",
                        background: c.surface,
                        borderTop: `1px solid ${c.hairline}`,
                    }}
                >
                    <div style={{ maxWidth: t.layout.wide, margin: "0 auto" }}>
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                alignItems: "baseline",
                                gap: "12px",
                            }}
                        >
                            <h2
                                style={{
                                    margin: 0,
                                    fontFamily: t.fonts.heading,
                                    fontSize: "24px",
                                    fontWeight: 600,
                                    letterSpacing: "-.025em",
                                    color: c.ink,
                                }}
                            >
                                {labels.related}
                            </h2>
                            {/* Says how the list was made, because a computed list that looks
                                hand-picked invites the reader to assume somebody chose. */}
                            <span
                                style={{
                                    fontFamily: t.fonts.mono,
                                    fontSize: "11.5px",
                                    color: c.muted,
                                }}
                            >
                                {labels.relatedNote}
                            </span>
                        </div>

                        <div
                            style={{
                                marginTop: "20px",
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
                                gap: "14px",
                            }}
                        >
                            {related.map((r) => (
                                <Link
                                    key={r.slug}
                                    href={`${route}/${r.slug}`}
                                    className={RELATED_CLASS}
                                    style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "10px",
                                        minWidth: 0,
                                        padding: "20px",
                                        borderRadius: t.radii.panel,
                                        border: `1px solid ${c.hairline}`,
                                        background: c.pageBg,
                                    }}
                                >
                                    <span
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "10px",
                                            fontFamily: t.fonts.mono,
                                            fontSize: "11px",
                                            color: c.muted,
                                        }}
                                    >
                                        {r.score !== undefined && (
                                            <span
                                                style={{
                                                    padding: "3px 8px",
                                                    borderRadius: t.radii.pill,
                                                    background: c.accentTint,
                                                    color: c.accentInk,
                                                    fontVariantNumeric: "tabular-nums",
                                                }}
                                            >
                                                {r.score.toFixed(4)}
                                            </span>
                                        )}
                                        {r.date && formatDate(config, r.date)}
                                    </span>
                                    <span
                                        style={{
                                            fontFamily: t.fonts.heading,
                                            fontSize: "17px",
                                            fontWeight: 600,
                                            lineHeight: 1.3,
                                            letterSpacing: "-.02em",
                                            color: c.ink,
                                        }}
                                    >
                                        {r.title}
                                    </span>
                                    {r.summary && (
                                        <span
                                            style={{
                                                fontSize: "14px",
                                                lineHeight: 1.6,
                                                color: c.secondaryInk,
                                            }}
                                        >
                                            {r.summary}
                                        </span>
                                    )}
                                </Link>
                            ))}
                        </div>
                    </div>
                </section>
            )}

            {footer}
        </div>
    );
}
