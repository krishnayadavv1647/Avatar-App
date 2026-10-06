import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import Icon from "./icons";
import { CATEGORIES } from "./tabs";

/**
 * One dropdown button per category. A category's button shows the active tab's
 * name while one of its tabs is open, so the nav doubles as "where am I".
 */
export default function AdminNav({ activeTab, onChange }) {
  return (
    <nav aria-label="Admin sections" className="flex flex-wrap gap-2">
      {CATEGORIES.map((category) => (
        <CategoryMenu key={category.label} category={category} activeTab={activeTab} onChange={onChange} />
      ))}
    </nav>
  );
}

function CategoryMenu({ category, activeTab, onChange }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const activeInCategory = category.tabs.find((t) => t.value === activeTab);

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

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          "flex h-9 items-center gap-2 rounded border px-3 text-ui font-medium transition-colors",
          activeInCategory
            ? "border-border-strong bg-surface-3 text-text"
            : "border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-text",
        )}
      >
        <Icon name={category.icon} size={14} />
        <span>{activeInCategory ? activeInCategory.label : category.label}</span>
        <Icon name="chevron" size={12} className={clsx("opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 min-w-[200px] rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {category.tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(tab.value);
                setOpen(false);
              }}
              className={clsx(
                "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-ui transition-colors hover:bg-surface-hover",
                tab.value === activeTab && "font-semibold text-text",
                tab.value !== activeTab && "text-text-muted",
              )}
            >
              <Icon name={tab.icon} size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
