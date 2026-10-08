import { useState } from "react";
import clsx from "clsx";

/**
 * A person's picture, or their initial on a coloured disc when they have none
 * (or the picture cannot load).
 *
 * @param {object} props
 * @param {{ name?: string, email?: string, photoUrl?: string | null }} props.user
 * @param {number} [props.size]  pixels, square
 */
export default function UserAvatar({ user, size = 40, className }) {
  const [broken, setBroken] = useState(false);
  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.4)) };

  if (user?.photoUrl && !broken) {
    return (
      <img
        src={user.photoUrl}
        alt=""
        aria-hidden
        onError={() => setBroken(true)}
        style={style}
        className={clsx("shrink-0 rounded-full border border-border object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={style}
      className={clsx("flex shrink-0 items-center justify-center rounded-full bg-pink font-semibold text-text-inverse", className)}
    >
      {initial}
    </span>
  );
}
