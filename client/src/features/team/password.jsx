import { useState } from "react";

export const MIN_PASSWORD = 10;

// No look-alikes (0/O, 1/l/I): a password someone reads out or types from a message.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A random password from the browser's secure generator. */
export function generatePassword(length = 14) {
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (n) => ALPHABET[n % ALPHABET.length]).join("");
}

/** A line with a Copy button, for the sign-in details to pass on. */
export function CopyLine({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the text is selectable, so it can still be copied by hand.
    }
  };
  return (
    <div>
      <p className="text-label text-text-faint">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all truncate rounded border border-border bg-bg px-3 py-2 text-ui">{value}</code>
        <button
          type="button"
          onClick={copy}
          className="h-9 shrink-0 rounded-sm border border-border-strong bg-surface px-3 text-label font-semibold transition-colors hover:bg-surface-3"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
