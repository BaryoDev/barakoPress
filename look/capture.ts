/*
 * One deterministic screenshot.
 *
 * Every line here shuts down one reason two captures of the same page differ. A look check that
 * flakes is switched off within a week, which leaves the migration with no gate at all, so the
 * list is deliberately long and each item says what it stops:
 *
 *   fonts        a page painted before its webfont arrives is a different page. Wait on
 *                document.fonts.ready, after the scroll that may have pulled in more of them.
 *   motion       prefers-reduced-motion is set on the context, CSS durations are zeroed, and the
 *                screenshot itself is taken with animations disabled, which rewinds what is left.
 *   caret        a focused input blinks. The caret is hidden and the focus is dropped.
 *   scrollbars   an overlay scrollbar paints on one capture and not the other. Hidden on both.
 *   lazy images  below the fold and never requested. Forced eager, then the page is scrolled from
 *                top to bottom and back so an observer that ignores the attribute still fires.
 *   the clock    a rendered date is the time the capture ran. Both sides run on a fixed clock, so
 *                anything the page computes from the current time lands on the same pixel.
 *   locale       date and number formatting follows the browser's locale and zone. Both are pinned.
 *   dark mode    a system preference would flip one capture and not the other. Pinned to light.
 *   workers      a service worker from a previous run can serve the previous run's page. Blocked.
 *   live content analytics, embeds and feeds are refused by URL, and what is left is masked.
 *
 * What is left over goes in the mask list, and a mask that stops matching is reported rather than
 * dropped, because a mask that silently matches nothing turns into a failure nobody can explain.
 */

import type { Browser } from "@playwright/test";

import { addressOf, type Target } from "./pairs.js";

export interface CaptureOptions {
    width: number;
    viewportHeight: number;
    fullPage: boolean;
    fixedTime: string;
    block: string[];
    mask: string[];
    timeout?: number;
}

export interface Capture {
    png: Buffer;
    /** Mask selectors that matched nothing, which is a mask that has stopped doing its job. */
    missingMasks: string[];
}

const STABILITY_CSS = `
*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  animation-iteration-count: 1 !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; scrollbar-width: none !important; }
::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
`;

export async function capture(browser: Browser, target: Target, options: CaptureOptions): Promise<Capture> {
    const timeout = options.timeout ?? 30_000;
    const context = await browser.newContext({
        viewport: { width: options.width, height: options.viewportHeight },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: "light",
        forcedColors: "none",
        locale: "en-US",
        timezoneId: "UTC",
        serviceWorkers: "block",
    });
    context.setDefaultTimeout(timeout);

    try {
        await context.addInitScript((css: string) => {
            const inject = () => {
                const style = document.createElement("style");
                style.setAttribute("data-look-check", "");
                style.textContent = css;
                (document.head ?? document.documentElement).append(style);
            };
            if (document.head) inject();
            else document.addEventListener("DOMContentLoaded", inject, { once: true });
        }, STABILITY_CSS);

        for (const pattern of options.block) {
            await context.route(pattern, (route) => route.abort());
        }

        const page = await context.newPage();
        await page.clock.setFixedTime(new Date(options.fixedTime));

        await page.goto(addressOf(target), { waitUntil: "load", timeout });

        for (const selector of target.click) {
            await page.locator(selector).first().click({ timeout });
        }
        if (target.waitFor) {
            await page.locator(target.waitFor).first().waitFor({ state: "visible", timeout });
        }

        // The init script is the one that matters, because it runs before the first paint. This is
        // the backstop for a page that replaced its own head.
        await page.addStyleTag({ content: STABILITY_CSS });

        await page.evaluate(async () => {
            for (const element of Array.from(document.querySelectorAll("img, iframe"))) {
                (element as HTMLImageElement).loading = "eager";
            }
            const step = window.innerHeight;
            const bottom = document.documentElement.scrollHeight;
            for (let y = 0; y < bottom; y += step) {
                window.scrollTo(0, y);
                await new Promise((done) => requestAnimationFrame(() => done(null)));
            }
            window.scrollTo(0, 0);

            await Promise.all(
                Array.from(document.images).map((image) =>
                    image.complete ? Promise.resolve() : image.decode().catch(() => undefined),
                ),
            );
            await document.fonts.ready;
            (document.activeElement as HTMLElement | null)?.blur();
            await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))));
        });

        // A page that keeps a socket open never goes idle, and that is not a reason to fail.
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

        const missingMasks: string[] = [];
        for (const selector of options.mask) {
            if ((await page.locator(selector).count()) === 0) missingMasks.push(selector);
        }

        const png = await page.screenshot({
            fullPage: options.fullPage,
            animations: "disabled",
            caret: "hide",
            scale: "css",
            mask: options.mask.map((selector) => page.locator(selector)),
            maskColor: "#ff00ff",
            timeout,
        });

        return { png, missingMasks };
    } finally {
        await context.close();
    }
}
