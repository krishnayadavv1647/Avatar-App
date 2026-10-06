import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { avatarApi } from "@/services/avatar.api";
import { PRESETS } from "@/features/studio/presets";
import TemplateCard from "@/features/studio/TemplateCard";
import MediaPreview from "@/components/media/MediaPreview";
import Button from "@/components/common/Button";
import AvatarCard from "@/features/avatars/AvatarCard";
import BannerCover from "@/features/site/BannerCover";

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
      {/* An admin's hero banners replace the built-in hero; with none active this is the same hero as before. */}
      <BannerCover onCreate={show} fallback={<HeroCarousel avatars={avatars || []} onCreate={show} />} />

      <section className="mt-8 px-6">
        <div className="border-b border-border">
          <h2 className="-mb-px inline-block border-b-[3px] border-pink pb-2.5 text-ui font-semibold uppercase tracking-wider">
            Templates
          </h2>
        </div>
        <div className="scroll-row mt-5 gap-4 pb-3">
          {PRESETS.map((preset) => (
            <div key={preset.id} className="w-[230px] shrink-0">
              <TemplateCard preset={preset} onPick={() => navigate(`/studio?template=${preset.id}`)} />
            </div>
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
      <h1 className="text-[34px] uppercase leading-[0.95] tracking-tight sm:text-[44px] lg:text-[56px]">
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
