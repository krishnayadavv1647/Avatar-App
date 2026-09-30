import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { avatarApi } from "@/services/avatar.api";
import { PRESETS } from "@/features/studio/presets";
import MediaPreview from "@/components/media/MediaPreview";
import Button from "@/components/common/Button";
import AvatarCard from "@/features/avatars/AvatarCard";

/**
 * The dashboard: a wide hero banner, a row of templates, then your avatars.
 *
 * Laid out like a creative-tool home page - the banner sells the one thing to
 * do next, and everything below is a horizontal shelf you can scan without
 * leaving the page. Templates come before your own avatars because on a new
 * workspace they are the only thing on the page, and picking one is the
 * fastest way to a first call.
 */
export default function Home() {
  const navigate = useNavigate();
  const show = () => navigate("/studio");
  const { data: avatars, isLoading } = useQuery({
    queryKey: ["avatars"],
    queryFn: avatarApi.list,
  });

  return (
    <>
      <HeroCarousel avatars={avatars || []} onCreate={show} />

      <section className="mt-8 px-6">
        <div className="border-b border-border">
          <h2 className="-mb-px inline-block border-b-[3px] border-pink pb-2.5 text-ui font-semibold uppercase tracking-wider">
            Templates
          </h2>
        </div>
        <div className="scroll-row mt-5 gap-4 pb-3">
          {PRESETS.map((preset) => (
            <TemplateCard key={preset.id} preset={preset} onPick={() => navigate(`/studio?template=${preset.id}`)} />
          ))}
        </div>
      </section>

      <section className="mt-8 px-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-h3 font-semibold">My avatars</h2>
          {avatars?.length > 0 && (
            <Link to="/avatars" className="text-ui text-text-muted hover:text-text">
              View all
            </Link>
          )}
        </div>

        {isLoading && <p className="mt-3 text-ui text-text-muted">Loading your avatars…</p>}

        {!isLoading && !avatars?.length && (
          <p className="mt-3 text-ui text-text-muted">
            No avatars yet. Pick a template above, or{" "}
            <button type="button" onClick={show} className="text-pink hover:underline">
              start from scratch
            </button>
            .
          </p>
        )}

        {avatars?.length > 0 && (
          <div className="scroll-row mt-5 gap-4 pb-3">
            <NewAvatarCard onCreate={show} />
            {avatars.map((avatar) => (
              <AvatarCard key={avatar._id} avatar={avatar} className="w-[230px] shrink-0" />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Hero                                                                      */
/* ------------------------------------------------------------------------ */

const ROTATE_MS = 7000;

/**
 * The banner. The first slide always invites creating an avatar; each of the
 * workspace's callable avatars (up to three) gets a slide inviting a call.
 *
 * Rotates on its own, but not while hovered - nobody wants the button they are
 * reaching for to change under the cursor - and not at all for people who have
 * asked their system for reduced motion.
 */
function HeroCarousel({ avatars, onCreate }) {
  const callable = avatars.filter((a) => a.callable).slice(0, 3);
  const slides = [{ key: "create" }, ...callable.map((a) => ({ key: a._id, avatar: a }))];

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const current = index % slides.length;

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (slides.length < 2 || paused || reduced) return undefined;
    const t = setInterval(() => setIndex((i) => (i + 1) % slides.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [slides.length, paused]);

  const previews = avatars.filter((a) => a.previewUrl).slice(0, 3);

  return (
    // overflow-clip, not hidden: the blurred backdrop is scaled past the edges,
    // and a hidden-overflow box can still be scrolled by focus or a click,
    // which slid the whole banner sideways.
    <div
      className="relative h-[300px] overflow-clip rounded-lg border border-border bg-surface lg:h-[320px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {slides.map((slide, i) => (
        <div
          key={slide.key}
          // Inert, so the buttons on faded-out slides cannot be tabbed to.
          inert={i !== current}
          className={clsx(
            "absolute inset-0 transition-opacity duration-700 ease-ease",
            i === current ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          {slide.avatar ? (
            <AvatarSlide avatar={slide.avatar} />
          ) : (
            <CreateSlide previews={previews} onCreate={onCreate} />
          )}
        </div>
      ))}

      {slides.length > 1 && (
        <div className="absolute bottom-5 right-6 z-10 flex items-center gap-1.5">
          {slides.map((slide, i) => (
            <button
              key={slide.key}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show slide ${i + 1}`}
              aria-current={i === current}
              className={clsx(
                "h-2 rounded-full transition-all duration-300",
                i === current ? "w-6 bg-pink" : "w-2 bg-white/50 hover:bg-white",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const CREATE_BACKGROUND = {
  background: [
    "radial-gradient(55% 90% at 80% 15%, color-mix(in srgb, var(--pink) 36%, transparent), transparent 70%)",
    "radial-gradient(45% 80% at 98% 100%, color-mix(in srgb, var(--purple) 30%, transparent), transparent 70%)",
    "radial-gradient(40% 70% at 55% 115%, color-mix(in srgb, var(--blue) 16%, transparent), transparent 70%)",
    "var(--surface)",
  ].join(", "),
};

function CreateSlide({ previews, onCreate }) {
  return (
    <div className="absolute inset-0" style={CREATE_BACKGROUND}>
      {previews.length > 0 && <PortraitFan avatars={previews} />}
      <HeroCopy
        bold="Avatar"
        light="Studio"
        subtitle="Create talking AI avatars and have real conversations with them."
        action={
          <Button variant="inverse" size="lg" onClick={onCreate}>
            <PlusGlyph />
            Create avatar
          </Button>
        }
      />
    </div>
  );
}

/**
 * A portrait photo does not fill a wide banner, so the same image is used
 * twice: blurred and dimmed as the backdrop, and sharp as a card on the right.
 */
function AvatarSlide({ avatar }) {
  return (
    <div className="absolute inset-0">
      <MediaPreview
        src={avatar.previewUrl}
        fallback=""
        className="absolute inset-0 h-full w-full scale-110 opacity-50 blur-2xl"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-black/10" />
      <PortraitFan avatars={[avatar]} />
      <HeroCopy
        bold="Talk to"
        light={avatar.name}
        subtitle="Ready when you are. Start a call right in the browser."
        action={
          <Button as={Link} to={`/call/${avatar._id}`} variant="inverse" size="lg">
            <PlayGlyph />
            Start call
          </Button>
        }
      />
    </div>
  );
}

function HeroCopy({ bold, light, subtitle, action }) {
  return (
    <div className="absolute inset-y-0 left-0 z-10 flex max-w-[min(640px,100%)] flex-col justify-center px-8 sm:px-10">
      <h1 className="text-[44px] uppercase leading-[0.95] tracking-tight sm:text-[56px]">
        <span className="block font-extrabold">{bold}</span>
        <span className="block truncate font-normal">{light}</span>
      </h1>
      <p className="mt-4 text-body text-text-muted">{subtitle}</p>
      <div className="mt-7">{action}</div>
    </div>
  );
}

/** Up to three portraits, fanned. Decorative only, so hidden from narrow screens. */
function PortraitFan({ avatars }) {
  const tilt = avatars.length === 1 ? [0] : avatars.length === 2 ? [-5, 5] : [-7, 0, 7];

  return (
    <div
      aria-hidden
      className="absolute right-[7%] top-1/2 hidden -translate-y-1/2 items-center lg:flex"
    >
      {avatars.map((a, i) => (
        <div
          key={a._id}
          style={{ transform: `rotate(${tilt[i]}deg)` }}
          className={clsx(
            "aspect-[3/4] overflow-hidden rounded-lg border border-border-strong bg-surface-3 shadow-lg",
            i > 0 && "-ml-12",
            tilt[i] === 0 ? "z-10 h-[250px]" : "h-[210px]",
          )}
        >
          <MediaPreview src={a.previewUrl} fallback="" className="h-full w-full" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Shelves                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Shelf cards: the picture fills the card, the name sits top-left over a
 * shade, and the action appears in the middle on hover - a round button with a
 * label under it. No caption below the card; the image carries it.
 *
 * Touch screens have no hover, so the whole card is the button and the overlay
 * is a hint, not the only way in.
 */
const CARD =
  "group relative block aspect-[5/7] w-[230px] shrink-0 overflow-clip rounded border border-border bg-surface-2 text-left";

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

function TemplateCard({ preset, onPick }) {
  // The photo comes from Unsplash's CDN; if it cannot load (offline, blocked),
  // the card falls back to the accent-tinted icon it always had.
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

function NewAvatarCard({ onCreate }) {
  return (
    <button
      type="button"
      onClick={onCreate}
      className="group flex aspect-[5/7] w-[230px] shrink-0 flex-col items-center justify-center gap-3 rounded border border-dashed border-border-strong bg-surface text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-3 transition-colors group-hover:bg-pink group-hover:text-text-inverse">
        <PlusGlyph size={22} />
      </span>
      <span className="text-ui font-medium">New avatar</span>
      <span className="text-sm text-text-faint">A photo and a brief</span>
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

function PlayGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4.5 2.8v10.4a.8.8 0 0 0 1.2.7l8.2-5.2a.8.8 0 0 0 0-1.4L5.7 2.1a.8.8 0 0 0-1.2.7Z" />
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
