import { useEffect, useState } from "react";
import clsx from "clsx";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { siteApi } from "@/services/site.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";

const ROTATE_MS = 15_000;
const FALLBACK = "linear-gradient(135deg,#0a0a0a,#1a1a2e 50%,#0f3460)";

/** A YouTube address as an embeddable one, or null if it is not recognisably YouTube. */
const youTubeEmbed = (url) => {
  const id = String(url || "").match(/(?:embed\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
};

/**
 * The dashboard cover, when an admin has published hero banners.
 *
 * Renders `fallback` - the built-in hero - unless at least one banner is
 * active, so a workspace with none looks exactly as it did before banners
 * existed. With several, they rotate in display order; hovering (or a reduced-
 * motion setting) stops the rotation, as it does on the built-in hero.
 */
export default function BannerCover({ fallback, onCreate }) {
  const navigate = useNavigate();
  const { data: banners = [] } = useQuery({ queryKey: ["site-banners"], queryFn: siteApi.banners, staleTime: 60_000, retry: 0 });

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  const count = banners.length;
  const current = count ? index % count : 0;

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (count < 2 || paused || reduced) return undefined;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => clearInterval(t);
  }, [count, paused]);

  // A fresh banner gets a fresh chance at its picture; one broken URL must not blank the rest.
  useEffect(() => setImageFailed(false), [current]);

  if (!count) return fallback;

  const b = banners[current];
  const background = b.backgroundImageUrl || b.imageUrl;
  const embed = youTubeEmbed(b.walkthroughVideoUrl);

  // An admin's link wins; without one the banner invites creating an avatar.
  const goCta = () => {
    const link = b.ctaLink;
    if (!link) return onCreate?.();
    if (/^https?:\/\//i.test(link)) window.open(link, "_blank", "noopener,noreferrer");
    else navigate(link);
  };

  return (
    <>
      <div
        className="relative h-[300px] overflow-clip rounded-lg border border-border bg-surface lg:h-[320px]"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {b.backgroundVideoUrl ? (
          <video key={b.backgroundVideoUrl} src={b.backgroundVideoUrl} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
        ) : background && !imageFailed ? (
          <img src={background} alt="" onError={() => setImageFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0" style={{ background: FALLBACK }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/25" />

        <div className="absolute inset-y-0 left-0 z-10 flex max-w-[min(640px,100%)] flex-col justify-end px-8 pb-8 sm:px-10">
          <h1 className="text-[34px] uppercase leading-[0.9] tracking-tight sm:text-[44px] lg:text-[56px]">
            <span className="block font-extrabold">{b.titleLine1 || b.title}</span>
            {b.titleLine2 && <span className="block truncate font-light">{b.titleLine2}</span>}
          </h1>
          <p className="mt-3 line-clamp-3 text-body text-white/80">{b.subtitle}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="inverse" size="lg" onClick={goCta}>
              {b.ctaText || "Try Now"}
            </Button>
            {embed && (
              <Button variant="secondary" size="lg" onClick={() => setShowVideo(true)}>
                Watch Walkthrough
              </Button>
            )}
          </div>
        </div>

        {count > 1 && (
          <div className="absolute bottom-5 right-6 z-10 flex items-center gap-1.5">
            {banners.map((banner, i) => (
              <button
                key={banner._id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show banner ${i + 1}`}
                aria-current={i === current}
                className={clsx("h-2 rounded-full transition-all duration-300", i === current ? "w-6 bg-pink" : "w-2 bg-white/50 hover:bg-white")}
              />
            ))}
          </div>
        )}
      </div>

      <Modal open={showVideo && Boolean(embed)} onClose={() => setShowVideo(false)} title="Walkthrough">
        <div className="aspect-video w-full overflow-hidden rounded bg-black">
          <iframe
            src={embed || undefined}
            title="Walkthrough"
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </Modal>
    </>
  );
}
