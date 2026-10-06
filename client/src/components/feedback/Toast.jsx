import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

/**
 * Small, self-dismissing messages in the bottom-right corner.
 *
 * `toast.success("Saved")`, `toast.error("Could not save")`, `toast.info(...)`
 * can be called from anywhere - an event handler, a mutation's onSuccess -
 * without a hook. <Toaster /> is mounted once, in AppProviders.
 *
 * For a message tied to a form field, show it in the form instead; a toast is
 * for "that action finished".
 */
let nextId = 1;
let items = [];
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn(items));

function push(kind, message, { duration = 4000, description } = {}) {
  const id = nextId++;
  items = [...items, { id, kind, message, description }];
  emit();
  setTimeout(() => dismiss(id), duration);
  return id;
}

function dismiss(id) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (message, options) => push("success", message, options),
  error: (message, options) => push("error", message, { duration: 7000, ...options }),
  info: (message, options) => push("info", message, options),
  dismiss,
};

export function Toaster() {
  const [current, setCurrent] = useState(items);
  useEffect(() => {
    listeners.add(setCurrent);
    return () => listeners.delete(setCurrent);
  }, []);

  if (!current.length) return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
      {current.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={clsx(
            "pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface px-4 py-3 shadow-lg",
            t.kind === "success" && "border-green",
            t.kind === "error" && "border-red",
            t.kind === "info" && "border-border-strong",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className={clsx("text-ui font-medium", t.kind === "error" && "text-red")}>{t.message}</p>
            {t.description && <p className="mt-1 whitespace-pre-line text-label text-text-muted">{t.description}</p>}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="text-text-muted transition-colors hover:text-text"
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
