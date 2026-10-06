import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { linkApi } from "@/services/link.api";
import MediaPreview from "@/components/media/MediaPreview";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import CallSurface from "@/features/call/CallSurface";
import { linkFace } from "@/features/call/CallOrb";

/**
 * The page a share link opens. For someone with no account: say who you are,
 * talk to the avatar, done.
 *
 * It shows nothing about the workspace behind the link, and tells the guest
 * plainly that the conversation is transcribed for whoever sent it - they are
 * being recorded by someone they may not know, and should hear that first.
 */
const NAME_KEY = "avatar-app.guest";
// Embedded on someone else's site, a visitor who skips the name still gets a call.
const EMBED_GUEST = "Website visitor";

/**
 * Tells the page hosting an embed what happened, so a developer can react
 * (open a chat, log an event). Nothing sensitive goes out - only the event.
 */
function notifyHost(type) {
  if (window.parent === window) return;
  window.parent.postMessage({ source: "avatar-app", type }, "*");
}

function rememberedGuest() {
  try {
    return JSON.parse(localStorage.getItem(NAME_KEY)) || { name: "", email: "" };
  } catch {
    return { name: "", email: "" };
  }
}

/**
 * `embedded` is the same flow inside an iframe on another site (/embed/:token):
 * no page chrome, the name is optional, and `?name=` / `?email=` let the host
 * page pass its signed-in visitor so they are not asked at all.
 */
export default function TalkPage({ embedded = false }) {
  const { token } = useParams();
  const [params] = useSearchParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["link", token],
    queryFn: () => linkApi.describe(token),
    retry: false,
  });

  const [phase, setPhase] = useState("form"); // form | call | ended
  const [guest, setGuest] = useState(() => {
    const remembered = rememberedGuest();
    return {
      name: params.get("name")?.slice(0, 80) || remembered.name,
      email: params.get("email")?.slice(0, 200) || remembered.email,
    };
  });
  const [call, setCall] = useState(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [startError, setStartError] = useState(null);
  // Hang-up and the room closing both end up in `end`, often back to back.
  const finished = useRef(false);

  const start = async (e) => {
    e.preventDefault();
    setStarting(true);
    setStartError(null);
    try {
      const who = embedded && !guest.name.trim() ? { ...guest, name: EMBED_GUEST } : guest;
      const connection = await linkApi.start(token, who);
      try {
        localStorage.setItem(NAME_KEY, JSON.stringify(guest));
      } catch {
        // Only a convenience for the next visit.
      }
      finished.current = false;
      setCall(connection);
      setPhase("call");
      notifyHost("call-started");
    } catch (err) {
      setStartError(err.details?.[0]?.message || err.message);
    } finally {
      setStarting(false);
    }
  };

  const end = useCallback(async () => {
    if (finished.current || !call) return;
    finished.current = true;
    setEnding(true);
    // Best effort: the call is over for the guest either way, and the server
    // also notices the room closing.
    await linkApi.end(token, call.conversationId, call.callToken).catch(() => {});
    setEnding(false);
    setCall(null);
    setPhase("ended");
    notifyHost("call-ended");
  }, [call, token]);

  // Closing the tab cancels ordinary requests, so the hang-up goes as a beacon.
  useEffect(() => {
    if (!call) return undefined;
    const onLeave = () => linkApi.endOnUnload(token, call.conversationId, call.callToken);
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [call, token]);

  if (isLoading) return <Shell embedded={embedded}><p className="text-center text-text-muted">Loading…</p></Shell>;

  if (error || !data) {
    return (
      <Shell embedded={embedded}>
        <div className="text-center">
          <h1 className="text-h2">This link is not active</h1>
          <p className="mt-2 text-text-muted">
            It may have been turned off or replaced. Ask whoever sent it for a new one.
          </p>
        </div>
      </Shell>
    );
  }

  const { avatar, available } = data;

  if (phase === "call" && call) {
    return (
      <Shell wide embedded={embedded}>
        <CallSurface
          connection={call}
          avatar={avatar}
          face={linkFace(token, avatar)}
          onEnd={end}
          ending={ending}
          onError={setStartError}
        />
      </Shell>
    );
  }

  if (phase === "ended") {
    return (
      <Shell embedded={embedded}>
        <div className="text-center">
          <MediaPreview
            src={avatar.previewUrl}
            fallback=""
            className="mx-auto h-20 w-20 rounded-full"
          />
          <h1 className="mt-5 text-h2">Thanks{guest.name ? `, ${guest.name.split(" ")[0]}` : ""}!</h1>
          <p className="mt-2 text-text-muted">
            Your conversation with {avatar.name} has ended.{embedded ? "" : " You can close this tab."}
          </p>
          <div className="mt-6 flex justify-center">
            <Button variant="secondary" onClick={() => setPhase("form")}>
              Talk again
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell embedded={embedded}>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <MediaPreview src={avatar.previewUrl} className="aspect-[4/3] w-full" />
        <form onSubmit={start} className="p-6">
          <h1 className="text-h2">Talk to {avatar.name}</h1>
          <p className="mt-1.5 text-ui text-text-muted">
            A live voice and video conversation with an AI avatar, right in your browser.
          </p>

          {available ? (
            <>
              <div className="mt-6">
                <Field
                  label={embedded ? "Your name (optional)" : "Your name"}
                  value={guest.name}
                  onChange={(name) => setGuest((g) => ({ ...g, name }))}
                  placeholder="Priya Sharma"
                  autoComplete="name"
                  required={!embedded}
                  maxLength={80}
                  disabled={starting}
                />
                {!embedded && (
                <Field
                  label="Email (optional)"
                  type="email"
                  value={guest.email}
                  onChange={(email) => setGuest((g) => ({ ...g, email }))}
                  placeholder="you@example.com"
                  autoComplete="email"
                  maxLength={200}
                  disabled={starting}
                />
                )}
              </div>

              {startError && <p className="mt-4 text-ui text-red">{startError}</p>}

              <Button
                type="submit"
                size="lg"
                fullWidth
                className="mt-6"
                disabled={starting || (!embedded && !guest.name.trim())}
              >
                {starting ? "Connecting…" : "Join call"}
              </Button>

              <p className="mt-4 text-label leading-relaxed text-text-faint">
                Your browser will ask to use your microphone. The conversation is transcribed, and
                the transcript is shared with {embedded ? "the owner of this website" : "whoever sent you this link"}.
              </p>
            </>
          ) : (
            <p className="mt-6 rounded border border-border-strong bg-surface-2 px-4 py-3 text-ui text-yellow">
              {avatar.name} is not available right now. Please try again later.
            </p>
          )}
        </form>
      </div>
    </Shell>
  );
}

function Shell({ children, wide = false, embedded = false }) {
  // Inside an iframe the host site sets the size; fill it and drop the footer.
  if (embedded) {
    return (
      <div className="flex min-h-screen flex-col justify-center bg-bg p-3">
        <main className="mx-auto w-full max-w-md">{children}</main>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <main
        className={`mx-auto flex w-full flex-1 flex-col justify-center px-4 py-10 ${wide ? "max-w-2xl" : "max-w-md"}`}
      >
        {children}
      </main>
      <footer className="pb-6 text-center text-label text-text-faint">
        <img src="/logo.png" alt="" aria-hidden className="mr-1.5 inline-block h-4 w-4 object-contain align-middle" />
        Avatar Studio
      </footer>
    </div>
  );
}
