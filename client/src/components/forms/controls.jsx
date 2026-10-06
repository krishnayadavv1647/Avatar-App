import clsx from "clsx";

/**
 * Form controls the admin screens share, in the same look as the avatar
 * settings page: a dark field on the page background, a lifted border on
 * focus. Each takes `onChange(value)` rather than the DOM event, like Field.
 */

const FIELD =
  "w-full rounded border border-border bg-bg px-3 text-ui text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong disabled:opacity-40";

export function Label({ htmlFor, children, hint }) {
  return (
    <div className="mb-2">
      <label htmlFor={htmlFor} className="block text-ui text-text-muted">
        {children}
      </label>
      {hint && <p className="mt-1 text-label text-text-faint">{hint}</p>}
    </div>
  );
}

export function TextArea({ value, onChange, rows = 4, className, mono = false, ...rest }) {
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(FIELD, "py-2", mono && "font-mono text-label", className)}
      {...rest}
    />
  );
}

export function Select({ value, onChange, children, className, ...rest }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(FIELD, "h-10 cursor-pointer appearance-none truncate pr-9 [color-scheme:dark]", className)}
        {...rest}
      >
        {children}
      </select>
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-text" : "bg-surface-3",
      )}
    >
      <span
        className={clsx(
          "absolute left-0 top-1 h-4 w-4 rounded-full transition-transform duration-200 ease-ease",
          checked ? "translate-x-5 bg-text-inverse" : "translate-x-1 bg-text",
        )}
      />
    </button>
  );
}

/** A labelled switch with help text, as the plan and notification forms lay them out. */
export function SwitchRow({ title, description, checked, onChange, disabled }) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-lg border border-border bg-bg px-4 py-3">
      <div className="min-w-0">
        <p className="text-ui font-medium">{title}</p>
        {description && <p className="mt-0.5 text-label text-text-faint">{description}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

export function Checkbox({ checked, onChange, children, disabled }) {
  return (
    <label className={clsx("flex cursor-pointer items-center gap-2 text-ui", disabled && "cursor-not-allowed opacity-60")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function Badge({ tone = "neutral", children, className }) {
  // Colours are CSS variables, so Tailwind's /opacity shorthand is not available;
  // the "dim" tokens exist for green and red, the rest sit on a neutral chip.
  const tones = {
    neutral: "bg-surface-3 text-text-muted",
    green: "bg-green-dim text-green",
    red: "bg-red-dim text-red",
    yellow: "bg-surface-3 text-yellow",
    blue: "bg-surface-3 text-blue",
    purple: "bg-surface-3 text-purple",
    orange: "bg-surface-3 text-orange",
    outline: "border border-border-strong text-text-muted",
  };

  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-label", tones[tone], className)}>
      {children}
    </span>
  );
}
