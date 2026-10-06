import sanitizeHtml from "sanitize-html";

/**
 * HTML an admin or an outside sender wrote is never trusted as-is. Two
 * profiles: `notificationHtml` for what end users see in the app (a small
 * rich-text set), and `emailHtml` for email bodies, which also needs layout
 * tags and inline styles. Neither allows scripts, event handlers, forms or
 * javascript: links.
 */

const SAFE_SCHEMES = ["http", "https", "mailto", "tel"];

const RICH_TEXT = [
  "h1", "h2", "h3", "h4", "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "strike",
  "ul", "ol", "li", "a", "blockquote", "span", "div", "code", "pre",
];

const EMAIL_EXTRA = [
  "img", "table", "thead", "tbody", "tr", "td", "th", "center", "small", "sub", "sup", "font",
];

const base = {
  allowedSchemes: SAFE_SCHEMES,
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  // Links open elsewhere without handing the new page a handle on this one.
  transformTags: {
    a: (tag, attribs) => ({
      tagName: "a",
      attribs: { ...attribs, ...(attribs.href ? { rel: "noopener noreferrer", target: "_blank" } : {}) },
    }),
  },
  // Dropped with their contents, so a <title> or <style> block does not leak out as text.
  nonTextTags: ["script", "style", "textarea", "option", "title", "noscript"],
};

const notificationOptions = {
  ...base,
  allowedTags: RICH_TEXT,
  allowedAttributes: { a: ["href", "name", "target", "rel"], "*": ["class"] },
};

const emailOptions = {
  ...base,
  allowedTags: [...RICH_TEXT, ...EMAIL_EXTRA],
  allowedAttributes: {
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "width", "height"],
    td: ["colspan", "rowspan", "align", "valign", "width"],
    th: ["colspan", "rowspan", "align", "valign", "width"],
    table: ["width", "align", "cellpadding", "cellspacing", "border"],
    font: ["color", "size", "face"],
    "*": ["class", "style", "align"],
  },
  // Inline styles may set looks, never pull in a URL or run an expression.
  allowedStyles: {
    "*": {
      color: [/^[#\w(),.\s%-]+$/],
      "background-color": [/^[#\w(),.\s%-]+$/],
      background: [/^(?!.*url\()[#\w(),.\s%-]+$/i],
      "font-size": [/^[\d.]+(px|em|rem|%|pt)$/],
      "font-weight": [/^[\w\d]+$/],
      "font-family": [/^[\w\s,'"-]+$/],
      "font-style": [/^\w+$/],
      "text-align": [/^(left|right|center|justify)$/],
      "text-decoration": [/^[\w\s-]+$/],
      "line-height": [/^[\d.]+(px|em|rem|%)?$/],
      "border-radius": [/^[\d.\s]+(px|em|rem|%)?$/],
      border: [/^[#\w(),.\s%-]+$/],
      padding: [/^[\d.\s]+(px|em|rem|%)?$/],
      margin: [/^[\d.\s]+(px|em|rem|%|auto)*$/],
      width: [/^[\d.]+(px|em|rem|%)$/],
      "max-width": [/^[\d.]+(px|em|rem|%)$/],
      display: [/^(block|inline|inline-block|none)$/],
      "letter-spacing": [/^[\d.-]+(px|em|rem)$/],
    },
  },
};

/** Rich text for a notification a signed-in user will read. */
export const notificationHtml = (html = "") => sanitizeHtml(String(html), notificationOptions);

/** An email body, whether the admin typed it or a sender mailed it in. */
export const emailHtml = (html = "") => sanitizeHtml(String(html), emailOptions);
