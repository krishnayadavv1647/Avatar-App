import clsx from "clsx";
import { useState } from "react";

/**
 * A template shelf card: the avatar's generated face with its name, and "Use
 * template" on hover. Shared by the dashboard and the Avatars page, so the
 * two can never look different.
 */

/**
 * Shelf cards: the picture fills the card, the name sits top-left over a
 * shade, and the action appears in the middle on hover - a round button with a
 * label under it. No caption below the card; the image carries it.
 *
 * Touch screens have no hover, so the whole card is the button and the overlay
 * is a hint, not the only way in.
 */
const CARD =
  "group relative block aspect-[5/7] w-full overflow-clip rounded border border-border bg-surface-2 text-left";

function CardChrome({ name, badges, overlay }) {
  return (
    <>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/60 px-6 text-center opacity-0 transition-opacity duration-200 ease-ease group-hover:opacity-100 group-focus-visible:opacity-100">
        {overlay}
      </div>

      {/* Name, top left, over a shade so it reads on any picture. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/65 to-transparent px-4 pb-10 pt-3.5">
        <span className="truncate text-ui font-semibold text-white">{name}</span>
        {badges}
      </div>
    </>
  );
}

function CardAction({ tone, icon, label, detail }) {
  return (
    <>
      <span
        className={clsx(
          "flex h-14 w-14 scale-90 items-center justify-center rounded-full text-text-inverse shadow-lg transition-transform duration-200 ease-ease group-hover:scale-100",
          tone === "green" ? "bg-green" : "bg-pink",
        )}
      >
        {icon}
      </span>
      <span className="text-ui font-medium text-white">{label}</span>
      {detail && <span className="line-clamp-2 text-sm text-white/70">{detail}</span>}
    </>
  );
}

export default function TemplateCard({ preset, onPick }) {
  // The face is a generated picture in /public/presets; until it has been made
  // (or if it cannot load) the card falls back to its accent-tinted icon.
  const [photoFailed, setPhotoFailed] = useState(false);
  const art = {
    background: [
      `radial-gradient(75% 55% at 50% 45%, color-mix(in srgb, var(--${preset.accent}) 34%, transparent), transparent 75%)`,
      "linear-gradient(180deg, var(--surface-2), var(--surface))",
    ].join(", "),
  };

  return (
    <button type="button" onClick={onPick} title={preset.description} className={CARD}>
      <div style={art} className="absolute inset-0">
        {preset.image && !photoFailed ? (
          <>
            <img
              src={preset.image}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setPhotoFailed(true)}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-ease group-hover:scale-[1.03]"
            />
            {/* A thin strip of the template's colour ties the photo to its type. */}
            <div
              aria-hidden
              style={{ background: `var(--${preset.accent})` }}
              className="absolute inset-x-0 bottom-0 h-1"
            />
          </>
        ) : (
          <div
            style={{ color: `var(--${preset.accent})` }}
            className="absolute inset-0 flex items-center justify-center transition-transform duration-300 ease-ease group-hover:scale-110"
          >
            <TemplateGlyph id={preset.id} />
          </div>
        )}
      </div>

      <CardChrome
        name={preset.label}
        overlay={
          <CardAction
            tone="pink"
            icon={<PlusGlyph size={22} />}
            label="Use template"
            detail={preset.description}
          />
        }
      />
    </button>
  );
}


/* ------------------------------------------------------------------------ */
/* Glyphs                                                                    */
/* ------------------------------------------------------------------------ */

const line = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

function PlusGlyph({ size = 16 }) {
  return (
    <svg {...line} width={size} height={size} viewBox="0 0 16 16" strokeWidth="1.8">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

const TEMPLATE_PATHS = {
  support: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="3" y="14" width="4" height="6" rx="1.5" />
      <rect x="17" y="14" width="4" height="6" rx="1.5" />
      <path d="M19 20a3 3 0 0 1-3 2h-3" />
    </>
  ),
  tutor: (
    <>
      <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h7A2.5 2.5 0 0 1 15 5.5v4a2.5 2.5 0 0 1-2.5 2.5H8l-3.5 3v-3A2.5 2.5 0 0 1 3 9.5Z" />
      <path d="M18 9h.5A2.5 2.5 0 0 1 21 11.5v4a2.5 2.5 0 0 1-2.5 2.5v3L15 18h-3.5A2.5 2.5 0 0 1 9 15.5V15" />
    </>
  ),
  interviewer: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M8.5 10h7M8.5 14h7M8.5 18h4" />
    </>
  ),
  demo: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4M10.5 8l4 2-4 2Z" />
    </>
  ),
  receptionist: (
    <>
      <path d="M3 18h18M5 18a7 7 0 0 1 14 0M12 11V9M10.5 9h3" />
    </>
  ),
  sales: (
    <>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9Z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  storyteller: (
    <>
      <path d="M12 6c-2-1.5-5-2-8-1.5v14c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-14c-3-.5-6 0-8 1.5Z" />
      <path d="M12 6v14" />
    </>
  ),
};

function TemplateGlyph({ id }) {
  return (
    <svg {...line} width="72" height="72" viewBox="0 0 24 24" strokeWidth="1.1">
      {TEMPLATE_PATHS[id] || TEMPLATE_PATHS.support}
    </svg>
  );
}
