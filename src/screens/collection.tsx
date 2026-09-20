import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AUTHOR_COLLECTION, CATEGORY_COLLECTION, POST_COLLECTION, type PressConfig } from "../config.js";
import { formatDate, type Post, type Ref } from "../cms.js";
import {
    collectionOf,
    getItem,
    getItemPreview,
    listCollection,
    listReferencing,
    referencedBy,
    type Item,
} from "../collections.js";
import { CmsError } from "../delivery.js";
import { Asset, renderProse } from "../assets.js";
import { siteConfig } from "../site.js";

/*
 * The collection screens: an index, a detail page, their metadata and static params, and the card and
 * item view they are drawn with.
 *
 * The blog factories are these with the blog's collections, so the markup here is the markup the blog
 * always had, class based against `barakopress/styles.css`. test/blog-wrappers.golden.json holds what
 * the blog rendered before this file existed, and the wrappers are checked against it byte for byte.
 */

export type CardProps = { config: PressConfig; featured?: boolean } & (
    | { item: Item; post?: undefined }
    | { post: Post; item?: undefined }
);

/** A post read by `listPosts`, as an item of the post collection, so one card renders both. */
function itemFromPost(config: PressConfig, post: Post): Item {
    const refs: Record<string, Ref | undefined> = {};
    for (const [field, ref] of Object.entries(collectionOf(config, POST_COLLECTION)?.references ?? {})) {
        if (ref.collection === AUTHOR_COLLECTION) refs[field] = post.author;
        if (ref.collection === CATEGORY_COLLECTION) refs[field] = post.category;
    }
    return {
        id: post.id,
        collection: POST_COLLECTION,
        slug: post.slug,
        title: post.title,
        summary: post.excerpt,
        body: post.body,
        date: post.publishedAt,
        image: post.coverImage,
        imageAlt: post.coverImageAlt,
        featured: post.featured,
        tags: post.tags,
        refs,
        seo: post.seo,
        content: { id: post.id, slug: post.slug, data: {} },
    };
}

function OptionLine({ item }: { item: Item }) {
    return (
        <p className="meta" data-option={item.option}>
            {item.color && (
                <span
                    aria-hidden
                    style={{
                        display: "inline-block",
                        width: "10px",
                        height: "10px",
                        marginRight: "8px",
                        borderRadius: "50%",
                        background: item.color,
                    }}
                />
            )}
            {item.option}
        </p>
    );
}

/**
 * One item in a list. Takes an `item` from `listCollection`, or a `post` from `listPosts` as it always
 * did. Every link comes from the collection's route and its references' routes.
 */
export function Card(props: CardProps) {
    const { config, featured = false } = props;
    const item = props.item ?? itemFromPost(config, props.post);
    const col = collectionOf(config, item.collection);
    const links = Object.entries(col?.references ?? {}).flatMap(([field, ref]) => {
        const target = item.refs[field];
        const route = collectionOf(config, ref.collection)?.route;
        return target && route ? [{ field, label: ref.label, href: `${route}/${target.slug}`, name: target.name }] : [];
    });

    return (
        <article
            className={featured ? "card featured-card" : "card"}
            style={item.color ? { borderLeft: `4px solid ${item.color}` } : undefined}
        >
            {featured && <span className="chip">Featured</span>}
            <h2>{col?.route !== undefined ? <Link href={`${col.route}/${item.slug}`}>{item.title}</Link> : item.title}</h2>
            <p className="meta">
                {item.date && <time dateTime={item.date}>{formatDate(config, item.date)}</time>}
                {links.map((l) => (
                    <Fragment key={l.field}>
                        {l.label ? ` ${l.label} ` : " "}
                        <Link href={l.href}>{l.name}</Link>
                    </Fragment>
                ))}
            </p>
            {item.option && <OptionLine item={item} />}
            {item.summary && <p className="excerpt">{item.summary}</p>}
            {item.tags.length > 0 && (
                <p className="tags">
                    {item.tags.map((t) => (
                        <span key={t} className="tag">
                            {t}
                        </span>
                    ))}
                </p>
            )}
        </article>
    );
}

export interface ItemViewProps {
    config: PressConfig;
    item: Item;
    /** Items of another collection that reference this one, listed under it. */
    related?: { collection: string; items: Item[] };
    /** True when the item is a draft read with a preview token. */
    preview?: boolean;
    backHref?: string;
}

/** A detail page: the item, and the items that reference it, as an author's archive always was. */
export function ItemView({ config, item, related, backHref = "/" }: ItemViewProps) {
    const noun = related ? collectionOf(config, related.collection)?.noun : undefined;
    const count = related?.items.length ?? 0;
    return (
        <div className="shell">
            <p className="meta">
                <Link href={backHref}>Back</Link>
            </p>
            <h1>{item.title}</h1>
            {item.option && <OptionLine item={item} />}
            {item.image && (
                <Asset
                    src={item.image}
                    alt={item.imageAlt ?? ""}
                    theme={config.theme}
                    style={{ width: "100%", borderRadius: config.theme.radii.panel }}
                />
            )}
            {item.summary && <p className="excerpt">{item.summary}</p>}

            {item.body && (
                <div className="prose" dangerouslySetInnerHTML={{ __html: renderProse(item.body, config.theme) }} />
            )}

            {item.url && (
                <p className="meta">
                    <a href={item.url} rel="noopener noreferrer">
                        {item.url}
                    </a>
                </p>
            )}

            {related && (
                <>
                    <h2 style={{ marginTop: "2.5rem" }}>
                        {count} {noun ? (count === 1 ? noun[0] : noun[1]) : related.collection}
                    </h2>
                    {related.items.map((i) => (
                        <Card key={i.id} config={config} item={i} />
                    ))}
                </>
            )}
        </div>
    );
}

export interface CollectionIndexOptions {
    /** Only items holding these values. See `listCollection`. */
    filter?: Record<string, string>;
    /** The heading. The collection's `label`, or the site's name and tagline, when unset. */
    heading?: string;
}

/** An index, rendered for an already resolved config. A catch-all serving a collection calls this. */
export async function CollectionIndexView({
    config,
    collection,
    filter,
    heading,
}: { config: PressConfig; collection: string } & CollectionIndexOptions) {
    const col = collectionOf(config, collection);
    if (!col) notFound();
    let items: Item[] = [];
    let failure = false;

    try {
        ({ items } = await listCollection(config, collection, { filter }));
    } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        // The type is not there, or not publicly deliverable, so nothing lives at this route.
        if (e instanceof CmsError && e.status === 404) notFound();
        // An unreachable CMS is the likeliest thing to be wrong, so it gets a readable page rather than
        // a stack trace. This render is not cached, so the next request retries.
        failure = true;
    }

    const featured = items.filter((i) => i.featured);
    const rest = items.filter((i) => !i.featured);
    const title = heading ?? col.label;

    return (
        <div className="shell">
            <header className="masthead">
                <h1>{title ?? config.site.name}</h1>
                {title === undefined && config.site.tagline && <p className="tagline">{config.site.tagline}</p>}
            </header>

            {failure && (
                <div className="notice error">
                    <p>
                        <strong>This page could not be loaded.</strong>
                    </p>
                    <p>Please try again shortly.</p>
                </div>
            )}

            {!failure && items.length === 0 && (
                <div className="notice">
                    <p>
                        <strong>Nothing published yet.</strong>
                    </p>
                    <p>Only published entries of a type opted into public delivery appear here.</p>
                </div>
            )}

            {featured.map((i) => (
                <Card key={i.id} config={config} item={i} featured />
            ))}
            {rest.map((i) => (
                <Card key={i.id} config={config} item={i} />
            ))}
        </div>
    );
}

/*
 * A factory rather than a component, because a Next route is a file and a package cannot write files
 * into someone else's app. The consumer's app/doctors/page.tsx is:
 *
 *     export default createCollectionIndex(config, "doctors");
 *     export const revalidate = 300;
 */
export function createCollectionIndex(base: PressConfig, collection: string, options: CollectionIndexOptions = {}) {
    return async function CollectionIndex() {
        const config = await siteConfig(base);
        return CollectionIndexView({ config, collection, ...options });
    };
}

export interface CollectionDetailOptions {
    /**
     * Read `?preview=TOKEN` for a draft, uncached. Reading searchParams makes the route dynamic, which a
     * site built with `output: "export"` refuses, so it is off unless asked for.
     */
    preview?: boolean;
    /**
     * The items listed under this one: a collection and the reference field on it that points here.
     * Unset, the first collection that references this one; false, none.
     */
    related?: { collection: string; via: string } | false;
    backHref?: string;
    /** Renders the page in place of `ItemView`. It gets no related items unless `related` names them. */
    view?: (props: ItemViewProps) => ReactNode | Promise<ReactNode>;
}

/** A detail page, rendered for an already resolved config. A catch-all serving a collection calls this. */
export async function renderCollectionDetail(
    config: PressConfig,
    collection: string,
    slug: string,
    options: CollectionDetailOptions = {},
    previewToken?: string,
): Promise<ReactNode> {
    if (!collectionOf(config, collection)) notFound();
    const item = previewToken
        ? await getItemPreview(config, collection, slug, previewToken)
        : await getItem(config, collection, slug);
    if (!item) notFound();

    const link =
        options.related === undefined ? (options.view ? undefined : referencedBy(config, collection)) : options.related || undefined;
    const related = link
        ? { collection: link.collection, items: await listReferencing(config, link.collection, item.id, link.via) }
        : undefined;

    const view = options.view ?? ItemView;
    return view({ config, item, related, preview: Boolean(previewToken), backHref: options.backHref });
}

type DetailParams = { params: Promise<{ slug: string }>; searchParams?: Promise<{ preview?: string }> };

export function createCollectionDetail(base: PressConfig, collection: string, options: CollectionDetailOptions = {}) {
    return async function CollectionDetail({ params, searchParams }: DetailParams) {
        const config = await siteConfig(base);
        const { slug } = await params;
        // A token routes to the uncached read, so a draft never enters the shared cache.
        const token = options.preview && searchParams ? (await searchParams).preview : undefined;
        return renderCollectionDetail(config, collection, slug, options, token);
    };
}

/*
 * Metadata from the API's resolved `seo` block rather than assembled here. A type opted into SEO fields
 * returns title, description, canonical, social image and noIndex on every public response, so this
 * maps, and an editor changing the meta description in the console changes the page.
 */
export function itemMetadata(item: Item): Metadata {
    const seo = item.seo;
    const title = seo?.title ?? item.title;
    const description = seo?.description ?? item.summary;
    const image = seo?.imageUrl ?? item.image;

    return {
        title,
        description,
        alternates: seo?.canonicalUrl ? { canonical: seo.canonicalUrl } : undefined,
        robots: seo?.noIndex ? { index: false, follow: false } : undefined,
        openGraph: {
            title,
            description,
            type: "article",
            publishedTime: item.date,
            images: image ? [image] : undefined,
        },
        twitter: {
            card: image ? "summary_large_image" : "summary",
            title,
            description,
            images: image ? [image] : undefined,
        },
    };
}

export function createCollectionMetadata(base: PressConfig, collection: string) {
    return async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
        const config = await siteConfig(base);
        const { slug } = await params;
        const item = await getItem(config, collection, slug);
        return item ? itemMetadata(item) : { title: "Not found" };
    };
}

/*
 * Slugs for a static export, paged to the end rather than to one hardcoded limit, since a static export
 * has no fallback and a slug not listed is a 404. A request-time site has no tenant at build, so it
 * lists nothing and renders on request.
 */
export function createCollectionStaticParams(config: PressConfig, collection: string) {
    return async function generateStaticParams(): Promise<{ slug: string }[]> {
        if (config.sites || !collectionOf(config, collection)) return [];
        const slugs: { slug: string }[] = [];
        for (let page = 1; ; page++) {
            let batch;
            try {
                batch = await listCollection(config, collection, { page, pageSize: 100 });
            } catch (e) {
                // A read that fails after earlier pages succeeded would ship an export missing the rest,
                // each a 404, so it fails the build instead.
                if (slugs.length > 0) throw e;
                // A build with no CMS reachable produces no routes. Under `output: "export"` Next then
                // refuses the build, which is the correct outcome for a static site with no content.
                break;
            }
            for (const item of batch.items) if (item.slug) slugs.push({ slug: item.slug });
            if (!batch.hasNextPage || batch.items.length === 0) break;
        }
        return slugs;
    };
}
