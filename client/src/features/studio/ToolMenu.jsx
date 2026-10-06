import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

/**
 * The toolbar's ⋯ menu. Opens upward, because the toolbar sits at the foot of
 * the stage, and closes on Escape or a click elsewhere.
 *
 * `items`: `{ label, onSelect, icon?, disabled?, title?, danger?, hidden? }`, or `{ separator: true }`.
 * `align` is the side of the button the menu lines up with.
 */
export default function ToolMenu({ items, label, disabled, align = "right", children }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !root.current?.contains(e.target) && setOpen(false);
    const escape = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const visible = items.filter((item) => !item.hidden);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {children}
      </button>

      {open && (
        <div
          role="menu"
          className={clsx(
            "absolute bottom-full z-30 mb-2 min-w-[190px] rounded-lg border border-border bg-surface p-1 shadow-lg",
            align === "left" ? "left-0" : "right-0",
          )}
        >
          {visible.map((item, i) =>
            item.separator ? (
              <div key={`sep-${i}`} className="my-1 h-px bg-border" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.title}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-ui transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40",
                  item.danger ? "text-red" : "text-text",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
