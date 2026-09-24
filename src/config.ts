/*
 * The seam.
 *
 * Everything a site differs on lives here, so a consumer configures the engine instead of forking
 * it. That matters because barakoCMS content types are defined at runtime: a client's posts are as
 * likely to be `article` with a `Headline` as they are to be the blog blueprint's `post` and
 * `Title`. An engine that compiles one shape in is one client's blog wearing a package name.
 *
 * The defaults are the `blog` blueprint the API ships, so a site that used the blueprint passes
 * nothing and gets the same behaviour as before this existed.
 *
 * Config reaches the screens through factories rather than a global, because a Next route is a
 * file and a package cannot write files into someone else's app. A consumer's route file calls
 * `createBlogIndex(config)` and exports the result. One import, one call, full control.
 */

import { readEnv, type PressEnv } from "./env.js";
import type { PressStore } from "./store.js";
import { resolveTheme, type PressTheme, type PressThemeInput } from "./theme.js";
import type { BlockPreset } from "./blocks/presets.js";
import type { ToneName } from "./blocks/tokens.js";

/*
 * The attributes the markdown renderer puts on a link. The browser entry, barakopress/markdown,
 * imports these, so this file must keep importing nothing from next/* or node:*. Its one import is
 * `env.js`, which imports nothing and touches the environment only inside a function, so nothing
 * here reads the environment at module scope.
 */
export const LINK_REL = "noopener noreferrer";
export const NEW_TAB_TARGET = "_blank";

/** The singleton content type a tenant's site settings live in, unless `sites.settingsType` names another. */
export const SETTINGS_TYPE = "site";

/** The keys of the blog's own collections, which the blog factories render. */
export const POST_COLLECTION = "post";
export const AUTHOR_COLLECTION = "author";
export const CATEGORY_COLLECTION = "category";

/**
 * The hosts an `embed` block frames unless a site names its own. Players, not a content shape: an
 * embed block exists to hold a video or a map, and every one of these serves a sandboxed player
 * over https. A site that needs another adds it in `embedHosts` rather than editing this.
 */
export const EMBED_HOSTS: readonly string[] = [
    "www.youtube-nocookie.com",
    "www.youtube.com",
    "youtube.com",
    "player.vimeo.com",
    "www.google.com",
    "open.spotify.com",
    "w.soundcloud.com",
];

/** Hosts as a site writes them: lowercased, a bare hostname each, anything else dropped. */
export function embedHosts(values: readonly string[] | undefined): string[] | undefined {
    if (!Array.isArray(values)) return undefined;
    const out = new Set<string>();
    for (const raw of values) {
        if (typeof raw !== "string") continue;
        const host = raw.trim().toLowerCase();
        if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) out.add(host);
    }
    return [...out];
}

/** Where a reference into a type that is no configured collection keeps its name and slug. */
export const REFERENCE_FIELDS: { title: FieldNames; slug: FieldNames } = { title: ["Name", "Title"], slug: ["Slug"] };

export interface TypeNames {
    /** The content type holding posts. */
    post: string;
    /** The type an author reference points at. Omit if the model has no authors. */
    author?: string;
    /** The type a category reference points at. Omit if the model has no categories. */
    category?: string;
    /** The type holding standalone pages. Omit if the site mounts no page route. */
    page?: string;
}

/**
 * Which field on the post type holds what.
 *
 * Only `title` and `body` are required; everything else is a feature the site does without if the
 * model has no field for it. An absent name means the engine never asks for that data and never
 * renders it, rather than rendering an empty slot.
 */
export interface FieldMap {
    title: string;
    body: string;
    slug?: string;
    excerpt?: string;
    publishedAt?: string;
    coverImage?: string;
    coverImageAlt?: string;
    featured?: string;
    tags?: string;
    /** The reference field pointing at the author type. */
    author?: string;
    /** The reference field pointing at the category type. */
    category?: string;
}

/**
 * Which field on the page type holds what. Its own map because a page is not a post: it has no
 * author, date or tags, and a post has no block list.
 */
export interface PageFieldMap {
    title: string;
    slug?: string;
    summary?: string;
    /** Markdown, rendered when the page has no blocks. */
    body?: string;
    /** A json field holding an ordered list of `{ type, props }`. See src/blocks. */
    blocks?: string;
    /**
     * A boolean. `true` stops `PageView` drawing the page's own title above its blocks (#102).
     *
     * `title` still names the page for a tab and for search, which is why this is its own field
     * rather than a second, alternate heading: a page that opens with its own heading block sets
     * this rather than losing a distinct tab title to double as the on-page one.
     */
    hideTitle?: string;
}

/** Where the consumer mounted each route, so generated links match the app's real shape. */
export interface RouteMap {
    /** The post route's prefix, for example "/blog" or "/writing". */
    post: string;
    author?: string;
    category?: string;
}

export interface PageSizes {
    index: number;
    feed: number;
    sitemap: number;
    archive: number;
}

/** A link a site shows. `href` is a path on the site or an absolute http or https URL. */
export interface SiteLink {
    label: string;
    href: string;
    /** A short marker drawn beside the label, such as a version. */
    badge?: string;
    /** Leaves the site. The built-in header draws every link as a plain anchor either way; a theme may not. */
    external?: boolean;
    /**
     * Space separated site paths this link is current on, in the header and the phone menu. `/` is
     * the home page alone; any other path covers itself and everything below it. It is a list rather
     * than the href because a link can be current on a path it does not point to, such as a chat
     * server's link on `/community`. Unset, the link is never marked current.
     */
    activeOn?: string;
    /** Links under this one, one level deep. Drawn in `headerLinks` and `menuLinks` only. */
    children?: SiteLink[];
}

export const HEADER_ACTION_VARIANTS = ["primary", "secondary", "plain"] as const;
export type HeaderActionVariant = (typeof HEADER_ACTION_VARIANTS)[number];

/** A call to action at the end of the header, such as "Get started". */
export interface HeaderAction extends Omit<SiteLink, "activeOn" | "children"> {
    variant: HeaderActionVariant;
}

export interface FooterColumn {
    heading: string;
    links: SiteLink[];
}

export interface SocialLink {
    network: string;
    href: string;
}

export interface TopBar {
    text?: string;
    links: SiteLink[];
}

export interface SiteIdentity {
    name: string;
    tagline?: string;
    /** Absolute origin, used for every absolute link in the feed, sitemap and robots. */
    url: string;
    logo?: string;
    logoAlt?: string;
    footerLogo?: string;
    favicon?: string;
    shareImage?: string;
    copyright?: string;
    topBar?: TopBar;
    headerLinks?: SiteLink[];
    /** The rows of the header's phone menu. Unset, the phone menu shows `headerLinks`. */
    menuLinks?: SiteLink[];
    headerActions?: HeaderAction[];
    footerColumns?: FooterColumn[];
    socialLinks?: SocialLink[];
}

/**
 * Request-time sites: one build serving several tenants, each read from its own site settings.
 *
 * Present means on. Absent, the engine behaves exactly as a build-time site: identity and theme
 * come from this file and nothing reads the request. See src/site.ts.
 */
export interface SitesConfig {
    /** The singleton content type holding a tenant's identity and theme. */
    settingsType: string;
    /**
     * The request header the host is read from. `host` unless a proxy in front rewrites it, in which
     * case the operator names the header that proxy sets. Never a forwarded header by default,
     * because any caller can send one.
     */
    hostHeader: string;
    /**
     * A request header carrying the tenant handle directly. Off unless named, and only safe when a
     * proxy in front sets it and strips any value a caller sent.
     */
    tenantHeader?: string;
    /**
     * A request header carrying the visitor's IP address, sent on to barakoCMS when a share link is
     * redeemed so its rate limit counts that visitor rather than this container. Off unless named,
     * and only safe when a proxy in front sets it and strips any value a caller sent. A value that
     * is not exactly one IP address is not sent.
     */
    visitorIpHeader?: string;
    /**
     * The tenant a host with no tenant of its own falls back to. Unset, such a host is a 404.
     * `CMS_DEFAULT_TENANT` is read at request time when this is not set.
     */
    defaultTenant?: string;
}

/**
 * A tenant's holding mode, read from its site settings (`Mode: "Holding"`). Present only while holding.
 *
 * Nothing secret lives here. A share link is redeemed through barakoCMS, and barakoPress never sees
 * a hash of its key.
 */
export interface Holding {
    /** `HoldingPath`: the site path of the page shown on every route. Absent renders the default holding page. */
    path?: string;
    /** `HoldingMessage`: the line the default holding page shows under the name and tagline. Absent shows no line. */
    message?: string;
}

/**
 * What a site serves at `/` (#44).
 *
 * Every site was a blog at the root, because the root route mounted the post index and nothing else
 * could be named. rckoronadal.org's home is a Pages page, and a clinic with no posts at all still
 * got an empty post index there. `path` is a page, the way `HoldingPath` is; `collection` is a
 * collection's index. Neither set, the post index renders, which is what every site did before this.
 */
export interface Home {
    /** `HomePath`: the site path of the page served at the root. */
    path?: string;
    /** `HomeCollection`: the key of the collection whose index is served at the root. */
    collection?: string;
}

/**
 * A block region: a page whose blocks are drawn as the site's header or footer.
 *
 * The same idea as `HoldingPath`. The header and the footer used to be drawn in code, with only
 * their links and their text configurable, so a clinic wanting a light footer with opening hours
 * and a map could not have one. A region is a list of blocks resolved and bound the way a page's
 * blocks are, which makes the arrangement the tenant's data and keeps the image the same
 * everywhere (barakoCMS D22).
 *
 * Nothing served at the path draws the built-in header or footer instead, so naming a page that is
 * not written yet leaves the site rendering.
 */
export interface Region {
    /** The site path of the page, for example "/site/footer". */
    path: string;
    /** The tone behind the region's blocks: a built-in one or one in `theme.tones`. `page` when unset. */
    tone?: ToneName | (string & {});
}

/** Where the header and the footer come from. A region that is absent is the built-in one. */
export interface SiteRegions {
    header?: Region;
    footer?: Region;
}

/**
 * A field name, or several tried in order until one holds a value. A name starting with "@" reads the
 * entry itself rather than its data: "@createdAt" or "@updatedAt".
 */
export type FieldNames = string | string[];

/** Which field on a collection's type holds what. Only `title` is required. */
export interface CollectionFields {
    title: FieldNames;
    slug?: FieldNames;
    /** Plain text under the title. */
    summary?: FieldNames;
    /** Markdown. */
    body?: FieldNames;
    date?: FieldNames;
    image?: FieldNames;
    imageAlt?: FieldNames;
    /** A boolean. A featured item leads its list. */
    featured?: FieldNames;
    /** A list of strings. */
    tags?: FieldNames;
    /** A link shown on the item's page. Only a site path or an http or https URL is shown. */
    url?: FieldNames;
    /** A portrait of whoever or whatever the item is, drawn above its title. Not the wide `image`. */
    photo?: FieldNames;
    /** How far along the entry is, 0 to 100, for a roadmap or a target. Read as text, not a number. */
    progress?: FieldNames;
    /**
     * How many of `progressTotal` are done, for a source that gives two counts rather than one
     * figure already worked out, a GitHub milestone's `closed_issues` being the case this is for.
     * Read as text, not a number, the same as `progress`. An entry whose `progress` field is set
     * and parses as a percentage draws that instead; one whose does not, or is blank, falls back
     * to this pair, entry by entry rather than for the whole collection.
     */
    progressCount?: FieldNames;
    /** What `progressCount` is out of. Meaningless, and ignored, without `progressCount`. */
    progressTotal?: FieldNames;
    /**
     * Where a card for this item links, when that is not the item's own route: an entry filled by a
     * sync usually carries the source's own URL. Only a site path or an http or https URL is used.
     * Falls back to `${route}/${slug}` when the collection has a route and this is unset.
     */
    href?: FieldNames;
}

export interface CollectionReference {
    /** The key of the collection the reference points into. */
    collection: string;
    /** The word a card puts before the link, for example "by". */
    label?: string;
    /** Whether the feed names the target as the item's category. */
    inFeed?: boolean;
}

/**
 * A content type the site renders as a list and a detail page. A hospital's doctors, a law firm's
 * people and the blog's posts are each one of these.
 */
export interface CollectionConfig {
    /** The content type holding the items. */
    type: string;
    /** The index is served at the route and an item at `${route}/${slug}`. Absent, items are listed and never linked. */
    route?: string;
    fields: CollectionFields;
    /** Reference fields on the type, by field name, in the order a card shows them. */
    references?: Record<string, CollectionReference>;
    /** Sent to the API, so ordering covers every row. For example "-PublishedAt". */
    sort?: string;
    /** Whether `createFeed(config, key)` serves it. */
    feed?: boolean;
    /** Whether its items are in the sitemap. On unless false. */
    sitemap?: boolean;
    /**
     * Whether the root catch-all serves an index at the route. On unless false. An item page below the
     * route is served either way, and a route file calling `createCollectionIndex` ignores this.
     *
     * The copy the index draws, in place of the engine's own words, reads as the index being on.
     */
    index?: boolean | CollectionIndexCopy;
    /**
     * A page whose blocks render above the list on the index, so the index is composed like a page and
     * the route stays the collection's. The page is data: it answers 404 at its own path and is left
     * out of the menu and the sitemap.
     */
    indexPage?: string;
    /** The byline name on an entry that names no author: the first reference is the byline. */
    defaultAuthor?: string;
    /** Items on its index. `pageSizes.index` when unset. */
    pageSize?: number;
    /** The heading of its index. The site's name and tagline when unset. */
    label?: string;
    /** How a count of its items reads, singular then plural. */
    noun?: [string, string];
    /** A choice field whose option picks the item's colour from `optionColors`. */
    colorBy?: string;
    /**
     * What an item page lists under the item. "reference" is the items of another collection pointing
     * at it, an author's posts being the oldest example; "semantic" is the items of this same
     * collection closest to it by meaning, which needs the CMS AI module and renders nothing without
     * it. False lists nothing. "reference" unless set, which is what every collection did before this
     * existed.
     */
    related?: "reference" | "semantic" | false;
    /** Whether an item page shows a read time worked out from its body. Off unless set. */
    readingTime?: boolean;
    /**
     * How an item page is drawn. "list" is the shell markup every collection has had, class based
     * against `barakopress/styles.css`. "article" is the reading column: a hero header, a byline, a
     * read time and a band of neighbours under it, styled inline from the theme so it looks right with
     * no stylesheet imported. The blog's posts are drawn that way and always were.
     */
    layout?: "list" | "article";
    /**
     * Set when the collection is a tree rather than a flat list: a manual with sections, an order and
     * pages nested under other pages. Unset, nothing about the collection changes.
     */
    tree?: CollectionTree;
}

/**
 * What a collection's index says, set by an editor rather than written in a theme. Each line is
 * optional, and an unset one leaves what the engine drew before.
 */
export interface CollectionIndexCopy {
    /** A short line above the heading. */
    eyebrow?: string;
    /** The heading, in place of the collection's `label`. */
    heading?: string;
    /** A line under the heading, in place of the site's tagline. */
    lede?: string;
    /** What an index with nothing published says, in place of `labels.empty` and `labels.emptyNote`. */
    empty?: string;
    /** What an index whose read failed says, in place of `labels.failed` and `labels.failedNote`. */
    unavailable?: string;
}

/** The copy a collection's index draws, or an empty one when it set none. */
export function indexCopy(col: CollectionConfig): CollectionIndexCopy {
    return typeof col.index === "object" && col.index !== null ? col.index : {};
}

/**
 * A collection whose items form a documentation tree (#23).
 *
 * Every name here is a field on the collection's own type, because the shape of a manual is content,
 * not code: which section a page sits in, where it comes in the order, what it hangs under, and which
 * product it documents. A site keeping its docs in a hand-written manifest replaces the manifest with
 * four fields and a setting.
 */
export interface CollectionTree {
    /** The field holding the heading an item is grouped under, for example "Getting started". */
    section?: FieldNames;
    /** The field holding the item's position. A number, or a string that reads as one. */
    order?: FieldNames;
    /** The field holding the slug of the item this one hangs under, or a reference to it. */
    parent?: FieldNames;
    /**
     * The field naming the product an item documents, matched against a product's key.
     *
     * One field name and not a list, unlike the roles above, because this one goes into an API
     * filter: a tree read for a product asks the CMS for that product's pages so the limit is spent
     * on them. A fallback list cannot be one filter, and reading every product and filtering here
     * would spend the limit before the wanted pages were reached.
     */
    product?: string;
    /**
     * The sections, in the order the sidebar shows them. A section not named here follows the ones
     * that are, in the order its first item came back in.
     *
     * Named rather than worked out from the items, because every rule that derives it is wrong for
     * somebody: a manual whose first page is "Quickstart" and whose second is "Access control" wants
     * Getting started above Reference, and no ordering of the pages says that on its own.
     */
    sections?: string[];
    /**
     * The products the switcher offers: a key, the word a reader sees, and where it goes. The key is
     * what the `product` field holds, so the switcher can mark the one being read.
     */
    products?: TreeProduct[];
    /**
     * Where the search box submits, and whether one is drawn at all.
     *
     * Named rather than assumed, because only the site knows which of its routes reads the query.
     * An index answers `?q=` when its route file passes `search: true`, and a page of blocks answers
     * through the `search` block; both make the route dynamic, which is the consumer's call to make.
     * Unset, no box is drawn, since a search box whose query nothing reads is a control that looks
     * like it works.
     */
    searchPath?: string;
    /**
     * Where "edit this page" points. The item's `editPath`, or its slug, is appended, so
     * `https://github.com/owner/repo/edit/master/` plus `docs/webhooks.md` is the whole link. Unset,
     * no such link is drawn.
     */
    editBase?: string;
    /** The field holding the item's path in whatever repository it is written in. Its slug when unset. */
    editPath?: FieldNames;
    /** The most items read to build the tree. `TREE_LIMIT` unless set. */
    limit?: number;
    /** How the tree screens are laid out. Every part is today's layout when unset. */
    variant?: TreeVariant;
    /**
     * Search the tree's own titles and headings in the page, as the reader types, rather than
     * submitting to `searchPath` and asking the API. The box is drawn whenever this is set; with a
     * `searchPath` as well, a reader with no script still gets that route's answer.
     */
    searchIndex?: boolean;
    /** The site's own glyphs for the tree's controls. */
    icons?: TreeIcons;
}

export const TREE_SWITCHERS = ["tabs", "list"] as const;
export const TREE_SIDEBARS = ["plain", "boxed"] as const;
export const TREE_PAGERS = ["wide", "halves"] as const;
export const TREE_SEARCHES = ["box", "compact"] as const;
export const TREE_DISCLOSURES = ["open", "closed"] as const;

/**
 * The layouts a tree's parts come in (#130). Each part is styled from tokens either way; these are
 * the choices a token cannot make, because they change which elements are drawn or where they sit.
 */
export interface TreeVariant {
    /**
     * `tabs`, the default: a row of pills above the search box. `list`: a labelled column of links
     * inside the sidebar, above the sections, styled as the sidebar's own links are.
     */
    switcher?: (typeof TREE_SWITCHERS)[number];
    /**
     * `plain`, the default: the sidebar sits in the page's wide column beside the page. `boxed`: the
     * page is split edge to edge, the sidebar a surface column with a hairline between it and the page.
     */
    sidebar?: (typeof TREE_SIDEBARS)[number];
    /** An "on this page" column of the item's second level headings, at the inline end. Off by default. */
    rail?: boolean;
    /**
     * `wide`, the default: previous and next each take what room there is and wrap on a phone.
     * `halves`: two equal halves that never wrap, with next on the right even when there is no previous.
     */
    pager?: (typeof TREE_PAGERS)[number];
    /**
     * `box`, the default: a labelled input with its results listed under it. `compact`: one well
     * holding an icon, the input and a "/" key hint, named for a screen reader rather than labelled
     * on screen, with its results in a panel floating over what follows.
     */
    search?: (typeof TREE_SEARCHES)[number];
    /**
     * How the sidebar sits on a phone. `open`, the default: open, under a control saying "Contents".
     * `closed`: closed until tapped, the control naming the section and the page being read. Above
     * the phone breakpoint both show the whole sidebar.
     */
    disclosure?: (typeof TREE_DISCLOSURES)[number];
}

/**
 * Glyphs a tree draws, as references to symbols already on the page (`#id`), for a site that ships its
 * own sprite. Unset, the engine draws its own.
 */
export interface TreeIcons {
    /** The magnifier in the compact search box. */
    search?: string;
    /** The chevron on the closed phone disclosure. */
    chevron?: string;
}

/** The most items read to build a tree when the collection does not say, and the most it may ask for. */
export const TREE_LIMIT = 500;

export interface TreeProduct {
    /** What the item's `product` field holds. */
    key: string;
    /** What the switcher shows. */
    label: string;
    /** Where the switcher sends a reader. A site path, or an http or https URL. */
    href: string;
    /** A short note drawn after the label in the list switcher, for example "on GitHub". */
    note?: string;
}

/**
 * The words a screen prints for a visitor, so a tenant writing in Filipino is not stuck with ours
 * (#47).
 *
 * The defaults are the English every site rendered before this existed, so a site that sets nothing
 * reads exactly as it did. A request-time site reads its tenant's `Labels` setting, key by key: set
 * `minRead` and the rest stay English. Anything that names the site's own content is not here, since
 * that is the entry's data or the collection's `label` and `noun`.
 */
export interface Labels {
    /** After the reading time on a post: "7 min read". */
    minRead: string;
    /** Before the author's name on a post. */
    by: string;
    /** The heading over the related posts band. */
    related: string;
    /** The line under that heading saying how the list was made. */
    relatedNote: string;
    /** The chip on a featured card. */
    featured: string;
    /** The link back from an item page to its list. */
    back: string;
    /** The back link on a post whose route is the site root. */
    home: string;
    /** The banner over a post being previewed as a draft. */
    preview: string;
    /** The title of an entry whose title field is empty. */
    untitled: string;
    /** The feed link in the built-in header. */
    feed: string;
    /** The notice on an index with nothing published. */
    empty: string;
    emptyNote: string;
    /** The notice on an index whose read failed. */
    failed: string;
    failedNote: string;
    /** The notice on the holding page after a share link that did not open. */
    shareInvalid: string;
    /** The title of the page a share link lands on while it is being opened. */
    shareTitle: string;
    /** What that page says to a visitor whose browser runs no script. */
    shareNoScript: string;
    /** The line it shows while the link is being redeemed. */
    shareOpening: string;
    /** The label and placeholder on the search box. */
    search: string;
    /** What the search box says when a query matched nothing. `{query}` is what was typed. */
    searchEmpty: string;
    /** The link to the item before this one in a tree's reading order. */
    previous: string;
    /** The link to the item after it. */
    next: string;
    /** The link to wherever the page is written. */
    editPage: string;
    /** What the collapsed sidebar says on a phone. */
    contents: string;
    /** The label on the product switcher. */
    products: string;
    /** The heading over a tree page's rail of its own headings. */
    onThisPage: string;
    /** What the closed phone disclosure says while it is open. */
    closeContents: string;
    /** The button that opens the header's phone menu. */
    openMenu: string;
    /** The same button while the menu is open. */
    closeMenu: string;
    /** The accessible name of the phone menu's list of links. */
    menu: string;
    /** The button beside a header link that shows its children. `{label}` is the link's label. */
    submenu: string;
}

export const DEFAULT_LABELS: Labels = {
    minRead: "min read",
    by: "by",
    related: "Related",
    relatedNote: "cosine similarity, computed on load, not curated",
    featured: "Featured",
    back: "Back",
    home: "Home",
    preview:
        "Preview. This is how the post will look. It is not published, and it is served uncached so nothing here reaches another reader.",
    untitled: "Untitled",
    feed: "RSS",
    empty: "Nothing published yet.",
    emptyNote: "Only published entries of a type opted into public delivery appear here.",
    failed: "This page could not be loaded.",
    failedNote: "Please try again shortly.",
    shareInvalid: "This link is not valid or has expired.",
    shareTitle: "Opening a share link",
    shareNoScript: "This share link needs JavaScript to open. Turn JavaScript on for this site, then open the link again.",
    shareOpening: "Opening the site.",
    search: "Search",
    searchEmpty: "Nothing matches that.",
    previous: "Previous",
    next: "Next",
    editPage: "Edit this page",
    contents: "Contents",
    products: "Products",
    onThisPage: "On this page",
    closeContents: "Close",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    menu: "Menu",
    submenu: "{label} links",
};

export const LABEL_KEYS = Object.keys(DEFAULT_LABELS) as (keyof Labels)[];

/**
 * How one option of a choice field is shown (#52).
 *
 * `OptionColors` painted a 4px border and nothing else, and every planned sibling was the same idea
 * again: a colour per option on a card grid, a glyph per entry, a short badge per grade level. So an
 * option carries a style, and each block decides what to do with it.
 */
export interface OptionStyle {
    /** A colour: a name from `Colors`, a theme slot, or a colour written out, resolved to the colour. */
    tone?: string;
    /** An icon name. One of the `ICONS` the engine draws; anything else draws nothing. */
    icon?: string;
    /** What to show in place of the option's own value, for example "P1" for "Primary one". */
    label?: string;
}

export interface PressConfig {
    types: TypeNames;
    fields: FieldMap;
    pageFields: PageFieldMap;
    routes: RouteMap;
    site: SiteIdentity;
    pageSizes: PageSizes;
    /** The cache tag this site purges. Two sites on one server need two tags. */
    cacheTag: string;
    /** How long a cached read may live with no webhook. Zero disables the backstop. */
    backstopSeconds: number;
    /** How long a read from the CMS may take before it counts as failed and the last good answer stands in. */
    cmsTimeoutMs: number;
    /** Passed to toLocaleDateString. */
    locale: string;
    /**
     * The ISO code a `money` binding format uses, for example "PHP". Unset, an amount renders as a
     * plain number: a default currency is one client's currency, and there is no neutral one.
     */
    currency?: string;
    /**
     * The hosts an `embed` block may frame, lowercased and without a port. `EMBED_HOSTS` unless the
     * site says otherwise, and a request-time site reads its tenant's `EmbedHosts` setting.
     */
    embedHosts: string[];
    /**
     * Named blocks saved as arrangements of primitives. A request-time site reads its tenant's
     * `Presets` setting, which is how a designer adds one without a barakoPress release.
     */
    presets: BlockPreset[];
    /**
     * The plugin packages whose blocks render, by name. Empty unless the site says otherwise, so an
     * image carrying plugins renders exactly as one without them until a tenant turns one on. A
     * request-time site reads its tenant's `Plugins` setting.
     */
    plugins: string[];
    /**
     * Where the CMS is, as the config file named it. Empty means it did not, and `CMS_URL` answers
     * when the call is made. Read it through `cmsUrlFor`, never straight off the config.
     */
    cmsUrl: string;
    /**
     * Tenant slug, as the config file named it. Unset means it did not, and `CMS_TENANT` answers when
     * the call is made. On a resolved request-time config it is the tenant the request belongs to.
     * Read it through `pinnedTenant`, never straight off the config.
     */
    tenant?: string;
    /** What the screens look like. See theme.ts for why appearance is config and not a stylesheet. */
    theme: PressTheme;
    /** Set when identity and theme are read per request from the tenant's site settings. */
    sites?: SitesConfig;
    /** Set by the tenant's settings on a request-time site while it is holding. Never set by hand. */
    holding?: Holding;
    /**
     * The header and the footer as block regions. A request-time site reads its tenant's
     * `HeaderPath`, `HeaderTone`, `FooterPath` and `FooterTone` settings, which win over anything
     * set here. Unset on both sides, the built-in header and footer render as they always did.
     */
    regions?: SiteRegions;
    /**
     * Where the Pages module's pages are mounted: "" is the site root, "/docs" puts /about at
     * /docs/about. Undefined means the site renders no page tree: no menu, no catch-all, no page in the
     * sitemap.
     */
    pages?: string;
    /**
     * First path segments a page mounted at the root may not take, lowercased. A page there would sit
     * on a route the app answers itself, and Next resolves a static segment before a catch-all, so it
     * would never render. The defaults are the configured routes and the files the engine mounts;
     * `reservedSlugs` in the input adds to them.
     */
    reservedSlugs: string[];
    /**
     * Every collection the site renders, by key. `post`, `author` and `category` are derived from
     * `types`, `fields` and `routes`; `collections` in the input adds to them or replaces one by key,
     * and a request-time site's `Collections` setting does the same per tenant.
     */
    collections: Record<string, CollectionConfig>;
    /**
     * Colours by `type.field`, then by option value, as CSS colours. A request-time site reads them from
     * the tenant's `OptionColors` setting. Sugar over `optionStyles`: an entry here is an option whose
     * style is a tone and nothing else, and both end up in `optionStyles`, which is what the blocks read.
     */
    optionColors: Record<string, Record<string, string>>;
    /**
     * How each option of a choice field is shown, by `type.field` then by option. A request-time site
     * reads `OptionStyles`, merged over whatever `OptionColors` said.
     */
    optionStyles: Record<string, Record<string, OptionStyle>>;
    /** The words the screens print. A request-time site reads the tenant's `Labels` setting. */
    labels: Labels;
    /**
     * Where the state a fleet of containers has to agree on is kept: the kept answers, the host map,
     * the webhook replay guard and the generation of each cache tag. Unset, it is in process and
     * bounded, which is what a single container always did. A deployment running more than one
     * container passes a store over something they share, and a purge one of them receives reaches
     * the rest (barakoPress #57).
     */
    store?: PressStore;
    /** What `createHome` serves at the root. A request-time site reads `HomePath` and `HomeCollection`. */
    home?: Home;
}

export type PressConfigInput = {
    types?: Partial<TypeNames>;
    fields?: Partial<FieldMap>;
    pageFields?: Partial<PageFieldMap>;
    routes?: Partial<RouteMap>;
    site?: Partial<SiteIdentity>;
    pageSizes?: Partial<PageSizes>;
    /*
     * Nested partials, so a site overriding one colour keeps the other seventeen. A flat
     * Partial<PressTheme> would take the whole colours object or none of it, which in practice
     * means every consumer pastes the full palette to change an accent.
     */
    theme?: PressThemeInput;
    sites?: Partial<SitesConfig>;
    /** Partial, so a site renaming one word keeps the English for the rest. */
    labels?: Partial<Labels>;
} & Partial<
    Omit<PressConfig, "types" | "fields" | "pageFields" | "routes" | "site" | "pageSizes" | "theme" | "sites" | "holding" | "labels">
>;

/**
 * The `blog` blueprint, which is what `POST /api/content-types/blueprints/blog` creates.
 *
 * `Blocks` is the one name here the blueprint does not create. A json field has to be added to the
 * page type with `POST /api/content-types/page/fields`, and until it is, a page renders its Body.
 */
const BLOG_BLUEPRINT: Pick<PressConfig, "types" | "fields" | "pageFields"> = {
    types: { post: "post", author: "author", category: "category", page: "page" },
    fields: {
        title: "Title",
        slug: "Slug",
        excerpt: "Excerpt",
        body: "Body",
        coverImage: "CoverImage",
        coverImageAlt: "CoverImageAlt",
        publishedAt: "PublishedAt",
        featured: "Featured",
        tags: "Tags",
        author: "Author",
        category: "Category",
    },
    pageFields: {
        title: "Title",
        slug: "Slug",
        summary: "Summary",
        body: "Body",
        blocks: "Blocks",
        hideTitle: "HideTitle",
    },
};

function trimSlash(path: string): string {
    let end = path.length;
    while (end > 0 && path.charCodeAt(end - 1) === 47) end--;
    return path.slice(0, end);
}

/*
 * The blog as collections. A site that sets types, fields and routes the way it always did gets these
 * three and the blog factories render them, so nothing about such a site changes. The term types keep
 * the names the archive always fell back through, and a reference is resolved only when its type exists,
 * because `include` names a field the API answers 400 for otherwise.
 */
function blogCollections(types: TypeNames, fields: FieldMap, routes: RouteMap): Record<string, CollectionConfig> {
    const names = (...list: (string | undefined)[]) => list.filter((n): n is string => Boolean(n));
    const references: Record<string, CollectionReference> = {};
    if (types.author && fields.author) references[fields.author] = { collection: AUTHOR_COLLECTION, label: "by" };
    if (types.category && fields.category) {
        references[fields.category] = { collection: CATEGORY_COLLECTION, label: "in", inFeed: true };
    }

    const collections: Record<string, CollectionConfig> = {
        [POST_COLLECTION]: {
            type: types.post,
            route: routes.post,
            fields: {
                title: fields.title,
                slug: fields.slug,
                summary: fields.excerpt,
                body: fields.body,
                date: names(fields.publishedAt, "@createdAt"),
                image: fields.coverImage,
                imageAlt: fields.coverImageAlt,
                featured: fields.featured,
                tags: fields.tags,
            },
            references,
            sort: fields.publishedAt ? `-${fields.publishedAt}` : undefined,
            feed: true,
            noun: ["post", "posts"],
        },
    };

    const term = (type: string, route: string | undefined, url?: string): CollectionConfig => ({
        type,
        route,
        fields: {
            title: names("Name", "Title", fields.title),
            slug: names(fields.slug, "Slug"),
            body: names("Description", "Bio"),
            photo: "Photo",
            ...(url ? { url } : {}),
        },
        sitemap: false,
        // Never listed at /authors or /categories unless a site mounts that route file itself, since no
        // blog site ever had those pages and a public list of either is a decision, not a default.
        index: false,
    });
    if (types.author) collections[AUTHOR_COLLECTION] = term(types.author, routes.author, "Website");
    if (types.category) collections[CATEGORY_COLLECTION] = term(types.category, routes.category, "Website");
    return collections;
}

function ownCollections(input: Record<string, CollectionConfig> | undefined): Record<string, CollectionConfig> {
    return Object.fromEntries(
        Object.entries(input ?? {}).map(([key, c]) => {
            if (c.route === undefined) return [key, c];
            const route = mountPath(c.route);
            // At the root an item would sit at /slug, where pages and every other route already are.
            if (!route) throw new Error(`collection "${key}" cannot be mounted at the site root`);
            return [key, { ...c, route }];
        }),
    );
}

/** Paths the engine's own route files answer, which a page at the site root must not take. */
/** What the engine itself serves at the root, which no page and no collection setting can have. */
export const RESERVED_AT_ROOT = ["api", "feed.xml", "sitemap.xml", "robots.txt", "_next", "_press", "_share", "%5fshare", "favicon.ico"];

function firstSegment(route: string | undefined): string | undefined {
    return route?.split("/").find(Boolean)?.toLowerCase();
}

/** "" for the root, otherwise a path with one leading slash and none trailing. */
function mountPath(value: string): string {
    const trimmed = trimSlash(value.trim());
    if (!trimmed) return "";
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** The two option maps as one: a colour is a style whose only field is its tone, and a style wins. */
function withOptionColors(
    colors: Record<string, Record<string, string>> | undefined,
    styles: Record<string, Record<string, OptionStyle>> | undefined,
): Record<string, Record<string, OptionStyle>> {
    const out: Record<string, Record<string, OptionStyle>> = {};
    for (const [key, options] of Object.entries(colors ?? {})) {
        out[key] = Object.fromEntries(Object.entries(options).map(([option, tone]) => [option, { tone }]));
    }
    for (const [key, options] of Object.entries(styles ?? {})) {
        out[key] = { ...out[key] };
        for (const [option, style] of Object.entries(options)) {
            out[key][option] = { ...out[key][option], ...style };
        }
    }
    return out;
}

function reservedSlugs(routes: (string | undefined)[], extra: string[] | undefined): string[] {
    // Only a route that is one segment reserves that segment. A collection at /docs/modules used to
    // reserve "docs" outright, so a page at /docs/guides/start was treated as taken and nothing
    // resolved it. A deeper route is matched segment by segment in isReservedPath instead, which is
    // the only place that can tell /docs/modules from its neighbours.
    const rootRoutes = routes.filter((r) => (r ?? "").split("/").filter(Boolean).length === 1);
    const named = [...RESERVED_AT_ROOT, ...rootRoutes.map(firstSegment), ...(extra ?? []).map((s) => s.trim().toLowerCase())];
    return [...new Set(named.filter((s): s is string => Boolean(s)))];
}

/**
 * Builds a complete config from a partial one.
 *
 * Site name and URL have no sensible default: a fallback of the engine's own name is how a client
 * site ends up with the vendor's brand in its masthead, so they are required and the type says so.
 * The one exception is a request-time site (`sites`), whose identity is the tenant's settings. What
 * `site` holds there is only the fallback for a field the settings leave out.
 */
/** AbortSignal.timeout takes a whole number of milliseconds up to 2^32 - 1 and throws on anything else. */
function timeoutMs(value: number | undefined): number {
    return Number.isInteger(value) && value! > 0 && value! <= 0xffff_ffff ? value! : 5_000;
}

export function defineConfig(
    input: PressConfigInput & ({ site: SiteIdentity } | { sites: Partial<SitesConfig> }),
): PressConfig {
    const routes = { post: "/blog", author: "/authors", category: "/categories", ...input.routes };
    const site = input.site ?? {};
    const types = { ...BLOG_BLUEPRINT.types, ...input.types };
    const fields = { ...BLOG_BLUEPRINT.fields, ...input.fields };
    const routeMap: RouteMap = {
        post: trimSlash(routes.post),
        author: routes.author ? trimSlash(routes.author) : undefined,
        category: routes.category ? trimSlash(routes.category) : undefined,
    };
    const collections = { ...blogCollections(types, fields, routeMap), ...ownCollections(input.collections) };

    return {
        types,
        fields,
        pageFields: { ...BLOG_BLUEPRINT.pageFields, ...input.pageFields },
        routes: routeMap,
        site: { ...site, name: site.name ?? "", url: trimSlash(site.url ?? "") },
        pageSizes: { index: 20, feed: 50, sitemap: 1000, archive: 50, ...input.pageSizes },
        cacheTag: input.cacheTag ?? "cms",
        backstopSeconds: input.backstopSeconds ?? 300,
        cmsTimeoutMs: timeoutMs(input.cmsTimeoutMs),
        locale: input.locale ?? "en-GB",
        ...(input.currency ? { currency: input.currency } : {}),
        embedHosts: embedHosts(input.embedHosts) ?? [...EMBED_HOSTS],
        presets: input.presets ?? [],
        plugins: [...(input.plugins ?? [])],
        cmsUrl: trimSlash(input.cmsUrl ?? ""),
        tenant: input.tenant,
        theme: resolveTheme(input.theme),
        collections,
        optionColors: input.optionColors ?? {},
        optionStyles: withOptionColors(input.optionColors, input.optionStyles),
        labels: { ...DEFAULT_LABELS, ...input.labels },
        ...(input.store ? { store: input.store } : {}),
        ...(input.home ? { home: input.home } : {}),
        reservedSlugs: reservedSlugs(
            [routes.post, routes.author, routes.category, ...Object.values(collections).map((c) => c.route)],
            input.reservedSlugs,
        ),
        ...(input.pages !== undefined ? { pages: mountPath(input.pages) } : {}),
        ...(input.regions ? { regions: input.regions } : {}),
        ...(input.sites
            ? {
                  sites: {
                      settingsType: input.sites.settingsType ?? SETTINGS_TYPE,
                      hostHeader: (input.sites.hostHeader ?? "host").toLowerCase(),
                      tenantHeader: input.sites.tenantHeader?.toLowerCase(),
                      visitorIpHeader: input.sites.visitorIpHeader?.toLowerCase(),
                      defaultTenant: input.sites.defaultTenant,
                  },
              }
            : {}),
    };
}

/*
 * The environment as a layer under the config (barakoPress #51).
 *
 * `defineConfig` runs at module scope in a consumer's `press.config.ts`, so it records what the
 * config file said and nothing else. These two read the environment on the call that needs the
 * value, which is the build for a static export and the request for a server. The order is the
 * order it always was: what the config named wins, then the variable, then the default.
 */

/** Where the CMS is when neither the config nor CMS_URL names one. */
export const DEFAULT_CMS_URL = "http://localhost:5005";

/** Where this call talks to: `cmsUrl` in the config, else `CMS_URL`, else localhost. */
export function cmsUrlFor(config: Pick<PressConfig, "cmsUrl">, env: PressEnv = readEnv()): string {
    return config.cmsUrl || trimSlash(env.cmsUrl ?? DEFAULT_CMS_URL);
}

/**
 * The tenant this config is pinned to: `tenant` in the config, else `CMS_TENANT`. Undefined for a
 * request-time config that has not resolved its tenant yet, which is not the same as none.
 */
export function pinnedTenant(config: Pick<PressConfig, "tenant">, env: PressEnv = readEnv()): string | undefined {
    return config.tenant ?? env.tenant ?? undefined;
}

/**
 * The reference fields worth resolving in one request, as the API's `include` expects them.
 *
 * Only names the site actually has. Sending `include=Author,Category` unconditionally is a 400
 * from the API for any post type without both fields, which is every model that is not the blog
 * blueprint.
 */
/**
 * True when some collection this site renders has a feed, so a feed link points somewhere.
 *
 * The blog's post collection has one, so a blog answers true as it always did. A tenant whose
 * collections are all `feed: false` shows no RSS link and no feed alternate (#44).
 */
export function hasFeed(config: PressConfig): boolean {
    return Object.values(config.collections).some((c) => c.feed === true && c.route !== undefined);
}

export function includesFor(config: PressConfig): string[] {
    const wanted: (string | undefined)[] = [
        config.types.author ? config.fields.author : undefined,
        config.types.category ? config.fields.category : undefined,
    ];
    return wanted.filter((f): f is string => Boolean(f));
}
