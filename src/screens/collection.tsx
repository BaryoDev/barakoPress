import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AUTHOR_COLLECTION, CATEGORY_COLLECTION, POST_COLLECTION, type CollectionConfig, type PressConfig } from "../config.js";
import { formatDate, type Post, type Ref } from "../cms.js";
import {
    collectionOf,
    getItem,
    getItemPreview,
    listCollection,
    listReferencing,
    referencedBy,
    searchCollection,
    type Item,
} from "../collections.js";
import { collectionTree, treeNeighbours, type CollectionTreeResult } from "../tree.js";
import { ArticleView, type ArticleRelated } from "./article-view.js";
import { EditLink, SearchBox, TreePager, TreeShell, TreeSidebar, TreeSwitcher } from "./tree.js";
import { CmsError } from "../delivery.js";
import { listRelatedItems } from "../related.js";
import { readingMinutes } from "../reading-time.js";
import { Asset, renderProse } from "../assets.js";
import { IconGlyph } from "../blocks/primitives.js";
import { siteConfig, type SiteParams } from "../site.js";

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
export function itemFromPost(config: PressConfig, post: Post): Item {
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

/*
 * The option an item holds, as the site shows it (#52): the tone as a dot, the icon beside it, and
 * the style's own word in place of the option's value. A tenant that set only a colour gets the dot
 * and the value, which is what this drew before styles existed.
 */
function OptionLine({ config, item }: { config: PressConfig; item: Item }) {
    const style = item.style;
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
            {style?.icon && (
                <span style={{ marginRight: "6px" }}>
                    <IconGlyph name={style.icon} size={config.theme.text.small} color={item.color ?? "currentColor"} />
                </span>
            )}
            {style?.label ?? item.option}
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
            {featured && <span className="chip">{config.labels.featured}</span>}
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
            {item.option && <OptionLine config={config} item={item} />}
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
    /**
     * The collection's tree, when it is one, already read. Passed in rather than fetched here so this
     * stays a component a test can render and a consumer can call with what it already has.
     */
    tree?: CollectionTreeResult;
}

/*
 * A detail page, in whichever layout the collection asked for, inside whatever chrome it needs.
 *
 * "article" is the reading column the blog has always drawn, which is now what any long-form
 * collection gets (#75). "list", the default, is the shell markup every collection has had. A tree
 * collection then gets a sidebar, a switcher and a search box beside it and previous, next and an
 * edit link under it, whichever layout it chose (#23).
 */
export function ItemView(props: ItemViewProps) {
    const { config, item, tree } = props;
    const col = collectionOf(config, item.collection);
    const body = col?.layout === "article" ? <ItemArticle {...props} /> : <ItemList {...props} />;
    if (!col?.tree || !tree) return body;

    const { previous, next } = treeNeighbours(tree.order, item.slug);
    const route = col.route ?? "";
    return (
        <TreeShell
            config={config}
            aside={
                <>
                    <TreeSwitcher config={config} collection={item.collection} current={item.product} />
                    {/* Only where the site named a route that reads the query. A box submitting
                        somewhere that ignores `q` is a control that looks like it works. */}
                    {col.tree.searchPath && (
                        <SearchBox
                            config={config}
                            action={col.tree.searchPath}
                            param="q"
                            id={`bp-search-${item.collection}`}
                        />
                    )}
                    <TreeSidebar config={config} tree={tree} current={item.slug} />
                </>
            }
        >
            {body}
            <TreePager config={config} collection={item.collection} previous={previous} next={next} />
            <EditLink config={config} item={item} />
        </TreeShell>
    );
}

/** The item as a card in the band under an article: its own route unless another collection owns it. */
function asBandCard(config: PressConfig, item: Item): ArticleRelated {
    const route = collectionOf(config, item.collection)?.route;
    return {
        slug: item.slug,
        title: item.title,
        ...(route !== undefined ? { href: `${route}/${item.slug}` } : {}),
        ...(item.date ? { date: item.date } : {}),
        ...(item.summary ? { summary: item.summary } : {}),
    };
}

function ItemArticle({ config, item, related, preview }: ItemViewProps) {
    return (
        <ArticleView
            config={config}
            item={item}
            preview={preview}
            related={(related?.items ?? []).map((i) => asBandCard(config, i))}
        />
    );
}

function ItemList({ config, item, related, backHref = "/" }: ItemViewProps) {
    const noun = related ? collectionOf(config, related.collection)?.noun : undefined;
    const count = related?.items.length ?? 0;
    // Worked out from the body rather than typed, so there is no field to keep in step with the prose.
    const col = collectionOf(config, item.collection);
    const minutes = col?.readingTime && item.body ? readingMinutes(item.body) : undefined;
    return (
        <div className="shell">
            <p className="meta">
                <Link href={backHref}>{config.labels.back}</Link>
            </p>
            {item.photo && (
                <Asset
                    src={item.photo}
                    alt={item.title}
                    theme={config.theme}
                    style={{ width: "120px", height: "120px", objectFit: "cover", borderRadius: config.theme.radii.pill }}
                />
            )}
            <h1>{item.title}</h1>
            {minutes !== undefined && (
                <p className="meta">
                    {minutes} {config.labels.minRead}
                </p>
            )}
            {item.option && <OptionLine config={config} item={item} />}
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
    /**
     * Answer `?q=` by listing what the API's search matched instead of the index.
     *
     * Off unless asked for, because reading the query makes the route dynamic and `output: "export"`
     * refuses a build outright over it. The same trade as preview, made in the consumer's own file.
     */
    search?: boolean;
}

/** The most rows a search on an index lists. The API caps its own side at fifty. */
const SEARCH_LIMIT = 20;

/** An index, rendered for an already resolved config. A catch-all serving a collection calls this. */
export async function CollectionIndexView({
    config,
    collection,
    filter,
    heading,
    query,
}: { config: PressConfig; collection: string; query?: string } & CollectionIndexOptions) {
    const col = collectionOf(config, collection);
    if (!col) notFound();
    const typed = (query ?? "").trim();
    let items: Item[] = [];
    let failure = false;

    try {
        ({ items } = typed
            ? { items: await searchCollection(config, collection, typed, SEARCH_LIMIT) }
            : await listCollection(config, collection, { filter }));
    } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        // The type is not there, or not publicly deliverable, so nothing lives at this route.
        if (e instanceof CmsError && e.status === 404) notFound();
        // An unreachable CMS is the likeliest thing to be wrong, so it gets a readable page rather than
        // a stack trace. This render is not cached, so the next request retries.
        failure = true;
    }

    // A search answers with what matched, in the order the API ranked it. Lifting a featured row to
    // the top there would put a worse match above a better one.
    const featured = typed ? [] : items.filter((i) => i.featured);
    const rest = typed ? items : items.filter((i) => !i.featured);
    const title = heading ?? col.label;

    const list = (
        <div className="shell">
            <header className="masthead">
                <h1>{title ?? config.site.name}</h1>
                {title === undefined && config.site.tagline && <p className="tagline">{config.site.tagline}</p>}
            </header>

            {failure && (
                <div className="notice error">
                    <p>
                        <strong>{config.labels.failed}</strong>
                    </p>
                    <p>{config.labels.failedNote}</p>
                </div>
            )}

            {!failure && items.length === 0 && (
                <div className="notice">
                    <p>
                        <strong>{typed ? config.labels.searchEmpty : config.labels.empty}</strong>
                    </p>
                    {!typed && <p>{config.labels.emptyNote}</p>}
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

    if (!col.tree) return list;
    // This route answers `?q=` when it was given one, so the box may point here; otherwise wherever
    // the tree says search lives, and nowhere at all when it says nothing.
    const searchAt = query !== undefined ? col.route : col.tree.searchPath;
    const tree = await collectionTree(config, collection);
    return (
        <TreeShell
            config={config}
            aside={
                <>
                    <TreeSwitcher config={config} collection={collection} />
                    {/* This index reads the query only when its route file said so, so the box is
                        drawn only then, or where the tree names somewhere else that does. */}
                    {searchAt !== undefined && (
                        <SearchBox config={config} action={searchAt} param="q" query={query} id={`bp-search-${collection}`} />
                    )}
                    <TreeSidebar config={config} tree={tree} />
                </>
            }
        >
            {list}
        </TreeShell>
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
    return async function CollectionIndex({
        params,
        searchParams,
    }: { params?: SiteParams; searchParams?: Promise<{ q?: string }> } = {}) {
        const config = await siteConfig(base, params);
        /*
         * Awaited only when the route file asked for search, because awaiting it is what makes the
         * route dynamic and `output: "export"` refuses a build over it (#55). An index with no search
         * never touches it and prerenders exactly as it did.
         */
        const asked = options.search && searchParams ? (await searchParams).q : undefined;
        // Repeated `?q=` arrives as an array, which nothing downstream can trim. Search was not asked
        // for in a shape this answers, so the index lists.
        const query = typeof asked === "string" ? asked : options.search ? "" : undefined;
        return CollectionIndexView({ config, collection, ...options, query });
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
     * Unset, the collection's own `related` setting decides; false, none.
     */
    related?: { collection: string; via: string } | false;
    backHref?: string;
    /** Renders the page in place of `ItemView`. It gets no related items unless `related` names them. */
    view?: (props: ItemViewProps) => ReactNode | Promise<ReactNode>;
}

/*
 * What goes under an item, in the order the decisions were made.
 *
 * A route file naming `related` wins, because it is the consumer's own file. A custom view gets
 * nothing unless it named it, which is what `createBlogPost` relies on. Then the collection's own
 * setting: "semantic" asks the CMS for its nearest neighbours, false lists nothing, and anything else
 * is the first collection referencing this one, which is what every collection did before the setting
 * existed. An empty semantic list is no band at all rather than a heading over nothing, the same as
 * the post page, since a site with no AI module gets one every time.
 */
async function relatedFor(
    config: PressConfig,
    collection: string,
    col: CollectionConfig,
    item: Item,
    options: CollectionDetailOptions,
): Promise<{ collection: string; items: Item[] } | undefined> {
    const byReference = async (link: { collection: string; via: string } | undefined) =>
        link ? { collection: link.collection, items: await listReferencing(config, link.collection, item.id, link.via) } : undefined;

    if (options.related !== undefined) return byReference(options.related || undefined);
    if (options.view) return undefined;
    if (col.related === "semantic") {
        const items = await listRelatedItems(config, collection, item);
        return items.length > 0 ? { collection, items } : undefined;
    }
    if (col.related === false) return undefined;
    return byReference(referencedBy(config, collection));
}

/** A detail page, rendered for an already resolved config. A catch-all serving a collection calls this. */
export async function renderCollectionDetail(
    config: PressConfig,
    collection: string,
    slug: string,
    options: CollectionDetailOptions = {},
    previewToken?: string,
): Promise<ReactNode> {
    const col = collectionOf(config, collection);
    if (!col) notFound();
    const item = previewToken
        ? await getItemPreview(config, collection, slug, previewToken)
        : await getItem(config, collection, slug);
    if (!item) notFound();

    const related = await relatedFor(config, collection, col, item, options);
    /*
     * The tree is read here rather than in the view, and for the product this page belongs to, so a
     * manual covering four products draws the sidebar of the one being read and spends its read
     * budget there. A collection that is not a tree reads nothing.
     */
    const tree = col.tree ? await collectionTree(config, collection, { product: item.product }) : undefined;

    const view = options.view ?? ItemView;
    return view({ config, item, related, tree, preview: Boolean(previewToken), backHref: options.backHref });
}

type DetailParams = { params: Promise<{ slug: string; site?: string }>; searchParams?: Promise<{ preview?: string }> };

export function createCollectionDetail(base: PressConfig, collection: string, options: CollectionDetailOptions = {}) {
    return async function CollectionDetail({ params, searchParams }: DetailParams) {
        const config = await siteConfig(base, params);
        const { slug } = await params;
        /*
         * A token routes to the uncached read, so a draft never enters the shared cache. Awaiting
         * `searchParams` is also what keeps this route out of the render cache, which is why the
         * route file that wants preview is the one that leaves `generateStaticParams` out (#55).
         */
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
    return async function generateMetadata({ params }: { params: Promise<{ slug: string; site?: string }> }): Promise<Metadata> {
        const config = await siteConfig(base, params);
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
