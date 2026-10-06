import { lazy, Suspense } from "react";
import DOMPurify from "dompurify";
import Icon from "../icons";

/**
 * Pieces the Comms and UI tabs share.
 *
 * HTML here comes from admins, or from whoever sent an email in - never
 * trusted. It is sanitised on the server when stored and again here when shown.
 */

// Links in rendered content open elsewhere and cannot reach back into this page.
let hooked = false;
function hookLinks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

export const sanitize = (html) => {
  hookLinks();
  // No inline styles: an email's CSS could position itself over the admin UI.
  return DOMPurify.sanitize(String(html || ""), { USE_PROFILES: { html: true }, FORBID_ATTR: ["style"], FORBID_TAGS: ["style", "form", "input", "button"] });
};

/** Rendered rich text, sanitised. */
export function SafeHtml({ html, className = "" }) {
  return <div className={`safe-html text-ui ${className}`} dangerouslySetInnerHTML={{ __html: sanitize(html) }} />;
}

/** The text of some HTML, for one-line previews. */
export const stripHtml = (html) =>
  new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent?.replace(/\s+/g, " ").trim() || "";

/**
 * A whole email as a recipient would see it. Sandboxed with every permission
 * off - no scripts, no forms, no navigation - so the email's own styling can
 * show without it being able to do anything.
 */
export function EmailPreview({ html, height = 420 }) {
  return (
    <iframe
      title="Email preview"
      sandbox=""
      srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank"><body style="margin:0;padding:16px;font-family:Helvetica,Arial,sans-serif;background:#fff;color:#1a1a1a;">${sanitize(html) || '<p style="color:#888">No content</p>'}</body>`}
      className="w-full rounded border border-border bg-white"
      style={{ height }}
    />
  );
}

const QuillEditor = lazy(() => import("./QuillEditor"));

/** The rich-text editor, loaded on first use because Quill is heavy and most visits never open one. */
export function RichText({ value, onChange, placeholder, toolbar = "full", height = 260 }) {
  return (
    <Suspense fallback={<div className="rounded border border-border bg-bg p-3 text-ui text-text-muted" style={{ height }}>Loading editor…</div>}>
      <QuillEditor value={value} onChange={onChange} placeholder={placeholder} toolbar={toolbar} height={height} />
    </Suspense>
  );
}

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="relative min-w-[200px] flex-1">
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="m10.5 10.5 3 3" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded border border-border bg-bg pl-9 pr-3 text-ui text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong"
      />
    </div>
  );
}

/** A centred icon, a heading and a line of help - the empty state every list uses. */
export function EmptyState({ icon = "layers", title, children, action }) {
  return (
    <div className="px-4 py-12 text-center">
      <Icon name={icon} size={40} className="mx-auto mb-4 text-text-faint" />
      {title && <h3 className="text-h3 font-semibold">{title}</h3>}
      {children && <p className="mt-2 text-ui text-text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Placeholder blocks while a list loads. */
export function Skeletons({ count = 3, className = "h-24" }) {
  return (
    <div className="space-y-3" aria-busy>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`animate-pulse rounded-lg border border-border bg-surface-2 ${className}`} />
      ))}
    </div>
  );
}

/** What went wrong, as a sentence for a toast. */
export const errorText = (err, fallback) => err?.message || fallback;

/** A date-time input's value (local, minute precision) from an ISO string. */
export function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Reads the shared "No API answered" / 503 style message into a short label for inline notices. */
export const MAIL_OFF = "Email is not configured on this server";
