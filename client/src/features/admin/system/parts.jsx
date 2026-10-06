import Card from "@/components/common/Card";
import Button from "@/components/common/Button";

/** A handful of stroke icons the System tabs need beyond the panel's nav set. */
const PATHS = {
  calls: "M3 3.5h3l1 3-1.8 1.2a8 8 0 0 0 3.6 3.6L10 9.5l3 1v3A1.5 1.5 0 0 1 11.5 15 9.5 9.5 0 0 1 1.5 5 1.5 1.5 0 0 1 3 3.5z",
  clock: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8 4.5V8l2.2 1.4",
  avatar: "M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 14c.4-2.6 2.6-4 5.5-4s5.1 1.4 5.5 4",
  app: "M2 3.5h12v9H2zM2 6h12",
  link: "M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1",
  meeting: "M2 4.5h8v7H2zM10 7l4-2v6l-4-2",
  up: "M3 10l5-5 5 5",
  down: "M3 6l5 5 5-5",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 9.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z",
  eyeOff: "M2 2l12 12M6.4 4a6 6 0 0 1 1.6-.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-2 2.5M4 5.6A11 11 0 0 0 1.5 8S4 12.5 8 12.5c1 0 1.9-.3 2.7-.7",
  copy: "M5.5 5.5h8v8h-8zM10.5 5.5v-2h-8v8h2",
  external: "M9 2.5h4.5V7M13.5 2.5L7 9M11.5 9.5v3.5h-9v-9H6",
  upload: "M8 11V2.5M4.5 6L8 2.5 11.5 6M2.5 11v2.5h11V11",
  test: "M6 2.5h4M7 2.5v4L3.5 13a1 1 0 0 0 .9 1.5h7.2a1 1 0 0 0 .9-1.5L9 6.5v-4",
  save: "M2.5 2.5h9l2 2v9h-11zM5 2.5v4h5v-4M5 13.5v-4h6v4",
  search: "M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM14 14l-3.5-3.5",
  check: "M3 8.5l3.5 3.5L13 4.5",
};

export function Glyph({ name, size = 16, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name] || PATHS.check} />
    </svg>
  );
}

/** A tab's heading: title, one line of purpose, and optional actions on the right. */
export function TabHeader({ title, description, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-h3">{title}</h2>
        {description && <p className="mt-1 text-ui text-text-muted">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

/** What a query shows while it loads or after it fails, with a way to retry. */
export function QueryState({ isLoading, error, onRetry, loading = "Loading…" }) {
  if (isLoading) return <p className="py-10 text-center text-ui text-text-muted">{loading}</p>;
  if (!error) return null;
  return (
    <Card className="py-8 text-center">
      <p className="font-medium text-red">Could not load this</p>
      <p className="mt-1 text-ui text-text-muted">{error.message}</p>
      <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
        Try Again
      </Button>
    </Card>
  );
}

/** "app_call" -> "app call". Every underscore, not just the first. */
export const humanize = (text) => String(text ?? "").replace(/_/g, " ");

/** "app call" -> "App call". */
export const sentence = (text) => {
  const t = humanize(text);
  return t.charAt(0).toUpperCase() + t.slice(1);
};
