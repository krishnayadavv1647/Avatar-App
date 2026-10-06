import { assertSafeUrl } from "../mcp/index.js";

/**
 * Reads a business's website as plain text: the page given plus the few pages
 * that say most about a business (about, services, pricing, FAQ, contact).
 *
 * The address is typed by a user and fetched by our servers, so every hop,
 * redirects included, goes through the same private-address check the MCP
 * client uses, only http(s) HTML is read, and size, time and page count are
 * all capped. What comes back is text for a language model to summarise - it
 * is untrusted and is never executed or rendered.
 */
const MAX_PAGES = 8;
const MAX_PAGE_BYTES = 1_500_000;
const MAX_PAGE_CHARS = 6_000;
const MAX_TOTAL_CHARS = 40_000;
const PAGE_TIMEOUT_MS = 10_000;
const BUDGET_MS = 30_000;
const MAX_REDIRECTS = 4;

const reject = (message) => Object.assign(new Error(message), { statusCode: 422 });

/** What makes a link worth following, best first. */
const WORTHY = [
  /about|who-we|our-story|company/i,
  /service|product|solution|offer|feature|what-we/i,
  /pricing|price|plans|packages|rates/i,
  /faq|help|support|questions/i,
  /contact|location|visit|hours|find-us/i,
  /menu|course|program|treatment|team|doctor|room/i,
];
const NOT_A_PAGE = /\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|ico|xml|json|docx?|xlsx?)(\?|$)/i;
const NOISE = /login|log-in|signin|sign-in|cart|checkout|account|privacy|terms|cookie|wp-admin|feed|tag\/|author\//i;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: "-", mdash: "-", hellip: "..." };
const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z0-9#]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);

const sameSite = (a, b) => a.replace(/^www\./, "") === b.replace(/^www\./, "");

/** Reads a body, giving up past the cap rather than holding a huge page in memory. */
async function readCapped(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_PAGE_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchHtml(startUrl, deadline) {
  let url = await assertSafeUrl(startUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const left = Math.min(PAGE_TIMEOUT_MS, deadline - Date.now());
    if (left <= 0) throw reject("The website took too long to read.");
    let res;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(left),
        headers: { "user-agent": "AvatarStudioBot/1.0 (+reads a page to brief an avatar)", accept: "text/html,application/xhtml+xml" },
      });
    } catch {
      throw reject(`Could not reach ${url.hostname}.`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertSafeUrl(new URL(res.headers.get("location"), url).href);
      continue;
    }
    if (!res.ok) throw reject(`${url.hostname} answered ${res.status}.`);
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (!/text\/html|application\/xhtml/.test(type)) throw reject("That address is not a web page.");
    return { url, html: await readCapped(res) };
  }
  throw reject("The website redirects too many times.");
}

/** The readable parts of a page: title, description, body text and the links on it. */
export function parseHtml(html, base) {
  const pick = (re) => decode((html.match(re)?.[1] || "").replace(/\s+/g, " ").trim());
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) ||
    pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);

  const links = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>/gi)) {
    try {
      const link = new URL(decode(m[1]), base);
      if (!["http:", "https:"].includes(link.protocol)) continue;
      links.push(link);
    } catch {
      // A malformed href is simply not a link.
    }
  }

  const text = html
    .replace(/<(script|style|noscript|svg|template|iframe|nav|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/address)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const body = decode(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return { title, description, body, links };
}

/** Same-site pages worth reading, most informative first, without repeats. */
function chooseLinks(links, start) {
  const seen = new Set([start.pathname.replace(/\/$/, "") || "/"]);
  const scored = [];
  for (const link of links) {
    if (!sameSite(link.hostname, start.hostname) || NOT_A_PAGE.test(link.pathname) || NOISE.test(link.pathname)) continue;
    const key = link.pathname.replace(/\/$/, "") || "/";
    if (seen.has(key) || key.split("/").length > 4) continue;
    seen.add(key);
    const rank = WORTHY.findIndex((re) => re.test(link.pathname));
    scored.push({ url: `${link.origin}${link.pathname}`, rank: rank === -1 ? WORTHY.length : rank });
  }
  return scored.sort((a, b) => a.rank - b.rank).map((l) => l.url);
}

/**
 * @returns {Promise<{ host: string, pages: Array<{ url: string, title: string, text: string }>, chars: number }>}
 */
export async function readSite(address) {
  const deadline = Date.now() + BUDGET_MS;
  const first = await fetchHtml(address, deadline);
  const start = first.url;

  const pages = [];
  let chars = 0;
  const take = (url, html) => {
    const { title, description, body, links } = parseHtml(html, url);
    const text = [description, body].filter(Boolean).join("\n").slice(0, MAX_PAGE_CHARS);
    if (text.length > 80 && chars < MAX_TOTAL_CHARS) {
      pages.push({ url: url.href, title, text: text.slice(0, MAX_TOTAL_CHARS - chars) });
      chars += Math.min(text.length, MAX_TOTAL_CHARS - chars);
    }
    return links;
  };

  const queue = chooseLinks(take(first.url, first.html), start);
  for (const next of queue) {
    if (pages.length >= MAX_PAGES || chars >= MAX_TOTAL_CHARS || Date.now() > deadline) break;
    try {
      const page = await fetchHtml(next, deadline);
      take(page.url, page.html);
    } catch {
      // One page failing does not spoil the rest.
    }
  }

  if (!pages.length) {
    throw reject(
      "Could not find readable text on that website. Sites that draw everything with JavaScript cannot be read - try a page with plain text, or add the details as a document.",
    );
  }
  return { host: start.hostname.replace(/^www\./, ""), pages, chars };
}
