import clsx from "clsx";

/**
 * The round-button + text + send-arrow bar the Generate and Edit dialogs share.
 * `before` is whatever sits to the left of the text (the settings button, or
 * undo and redo); `after` is to the right of the bar (Done).
 */
export default function PromptBar({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  busy,
  before,
  after,
  autoFocus,
  maxLength = 1000,
}) {
  const canSend = !disabled && !busy && value.trim().length >= 3;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
      className="flex w-full items-center gap-2"
    >
      {before}
      <div className="flex h-11 min-w-0 flex-1 items-center rounded-full border border-border-strong bg-bg pl-4 pr-1.5 transition-colors focus-within:border-text-muted">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled || busy}
          autoFocus={autoFocus}
          maxLength={maxLength}
          aria-label={placeholder}
          className="min-w-0 flex-1 bg-transparent text-ui text-text outline-none placeholder:text-text-faint disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          className={clsx(
            "flex h-8 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
            canSend ? "bg-text text-text-inverse hover:bg-white" : "bg-surface-3 text-text-faint",
          )}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
          </svg>
        </button>
      </div>
      {after}
    </form>
  );
}

/** A round icon button, as in the mock-ups' settings, undo and redo buttons. */
export function RoundButton({ label, children, className, ...rest }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={clsx(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-strong bg-bg text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-bg disabled:hover:text-text-muted",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A ring that turns, while a picture is being made. */
export function Spinner({ label }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 text-ui text-text-muted">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-border-strong border-t-text" />
      {label}
    </div>
  );
}
