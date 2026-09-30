import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { avatarApi, embedUrl, shareUrl, widgetScriptUrl } from "@/services/avatar.api";
import MediaPreview from "@/components/media/MediaPreview";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import ShareDialog from "./ShareDialog";

/**
 * The Build tab: every way to take the avatar out of this app - into your own
 * product, onto a website, into a Zoom / Meet / Teams call, or out as a link.
 *
 * The embed and the widget run on the avatar's public link, so the link card is
 * also where it is turned on. Meeting invites go through LemonSlice and need
 * no link.
 */
export default function AvatarBuild({ avatar }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null); // share | invite

  const { data: share } = useQuery({
    queryKey: ["share", avatar._id],
    queryFn: () => avatarApi.getShare(avatar._id),
  });
  const linked = Boolean(share?.enabled && share.token);

  const enableLink = useMutation({
    mutationFn: () => avatarApi.setShare(avatar._id, true),
    onSuccess: (next) => {
      queryClient.setQueryData(["share", avatar._id], next);
      queryClient.invalidateQueries({ queryKey: ["avatars"] });
    },
  });

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-5 px-4 pb-12 pt-2 sm:px-6">
      <BuildWithAI avatar={avatar} token={linked ? share.token : null} />

      <Row
        icon={<WidgetIcon />}
        title="Widget editor"
        description="Embed this avatar into any website with a couple of lines of code."
        action={
          <Button variant="secondary" onClick={() => setDialog("share")}>
            Open editor
          </Button>
        }
      />

      <Row
        icon={<VideoIcon />}
        title="Invite to video call"
        description="Zoom, Google Meet, Teams or Webex meeting."
        action={
          <Button variant="secondary" onClick={() => setDialog("invite")}>
            Invite
          </Button>
        }
      />

      <Row
        icon={<InfoIcon />}
        title="Agent ID"
        description="Use this ID to reference your avatar programmatically."
        action={<CopyButton text={avatar._id} label="Copy ID" />}
      />

      <Row
        icon={<LinkIcon />}
        title="Shareable link"
        description={
          linked ? (
            <span className="break-all font-mono text-label">{shareUrl(share.token)}</span>
          ) : (
            "A page anyone can open to talk to this avatar."
          )
        }
        action={
          linked ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDialog("share")}>
                Manage
              </Button>
              <CopyButton text={shareUrl(share.token)} label="Copy link" />
            </div>
          ) : (
            <Button variant="secondary" onClick={() => enableLink.mutate()} disabled={enableLink.isPending}>
              {enableLink.isPending ? "Turning on…" : "Get link"}
            </Button>
          )
        }
        footer={enableLink.error && <p className="text-ui text-red">{enableLink.error.message}</p>}
      />

      {dialog === "share" && <ShareDialog avatar={avatar} onClose={() => setDialog(null)} />}
      {dialog === "invite" && (
        <InviteDialog avatar={avatar} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

const AI_TOOLS = ["Lovable", "Cursor", "Codex", "Claude", "Devin", "Copilot"];

/**
 * Copies a prompt an AI coding tool can act on without further questions:
 * what the avatar is, the exact code for both embed forms, and the options.
 */
function buildPrompt(avatar, token) {
  const iframe = `<iframe src="${embedUrl(token)}" title="${avatar.name.replace(/"/g, "&quot;")}" width="400" height="640" allow="microphone; camera; autoplay" style="border:0;border-radius:16px;max-width:100%"></iframe>`;

  return `Add my AI video avatar "${avatar.name}" to this app. It is a live talking avatar (voice and video) that visitors have a real-time conversation with in the browser.

Option A - floating chat widget (recommended for most sites). Add this script tag once, just before </body>, on every page where the avatar should be available:

<script src="${widgetScriptUrl()}" data-token="${token}" async></script>

Optional attributes on the script tag:
- data-name / data-email: the signed-in user's name and email, so they are not asked
- data-position="left": show the button bottom-left instead of bottom-right
From your own code, window.AvatarApp.open() opens the avatar panel (e.g. from a "Talk to us" button).

Option B - inline. Place this iframe wherever the avatar should appear on the page:

${iframe}

Append ?name=...&email=... to the iframe src to pass the signed-in user. Keep allow="microphone; camera; autoplay" - without it the browser blocks the microphone.

Events: the embed posts window messages { source: "avatar-app", type: "call-started" | "call-ended" } to the parent page, which you can listen for with window.addEventListener("message", ...).

Rules:
- Use the URLs exactly as given; do not proxy, rewrite or self-host them.
- The page must be served over HTTPS (or localhost) for microphone access.
- Choose the option that fits this app's layout and match the surrounding styling.`;
}

function BuildWithAI({ avatar, token }) {
  return (
    <section className="grid overflow-hidden rounded-[20px] border border-border bg-surface-2 md:grid-cols-[1fr_280px]">
      <div className="flex flex-col p-6 sm:p-7">
        <h2 className="text-body font-semibold">Add this avatar to your app</h2>
        <p className="mt-1 max-w-sm text-ui text-text-muted">
          Copy a ready-made prompt and paste it into your AI coding tool - it has the code and the
          instructions to put {avatar.name} in your product.
        </p>

        <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 sm:max-w-xs">
          {AI_TOOLS.map((tool) => (
            <li key={tool} className="flex items-center gap-2.5 text-ui font-medium">
              <span
                aria-hidden
                className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-surface-3 text-[10px] font-bold text-text-muted"
              >
                {tool[0]}
              </span>
              {tool}
            </li>
          ))}
        </ul>

        <div className="mt-6">
          {token ? (
            <CopyButton
              text={buildPrompt(avatar, token)}
              label="Build with AI"
              copiedLabel="Prompt copied - paste it into your tool"
              variant="inverse"
              fullWidth
            />
          ) : (
            <>
              <Button variant="inverse" fullWidth disabled>
                <CopyIcon />
                Build with AI
              </Button>
              <p className="mt-2 text-label text-text-faint">
                Turn on the shareable link below first - the embed runs on it.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center border-t border-border bg-surface p-6 md:border-l md:border-t-0">
        <MediaPreview
          src={avatar.previewUrl}
          alt={avatar.name}
          fallback=""
          className="aspect-[3/4] w-[180px] rounded-[40%] bg-surface-3"
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * Paste a meeting link and the avatar joins it as a participant, through
 * LemonSlice: its face and voice appear in the meeting, and it hears and
 * answers the people there. Underneath it is an ordinary call - it shows up in
 * Conversations and ends at the avatar's time limit - so "Remove from meeting"
 * simply ends that call. The call id is only kept while this dialog is open.
 */
function InviteDialog({ avatar, onClose }) {
  const [meetingUrl, setMeetingUrl] = useState("");
  const [conversationId, setConversationId] = useState(null);
  const lemonslice = avatar.providerId === "lemonslice";

  const invite = useMutation({
    mutationFn: () => avatarApi.joinMeeting(avatar._id, meetingUrl.trim()),
    onSuccess: (res) => setConversationId(res.conversationId),
  });

  const leave = useMutation({
    mutationFn: () => avatarApi.leaveMeeting(avatar._id, conversationId),
    onSuccess: () => {
      setConversationId(null);
      setMeetingUrl("");
    },
  });

  const error = invite.error || leave.error;
  const blocked = !lemonslice ? "Only LemonSlice avatars can join meetings." : !avatar.callable
    ? avatar.unavailableReason || "This avatar cannot take calls right now."
    : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Invite ${avatar.name} to a meeting`}
      description="The avatar joins as a participant, listens to the meeting and answers out loud - with its face on camera."
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      {blocked ? (
        <p className="rounded border border-border-strong bg-surface-2 px-4 py-3 text-ui text-yellow">{blocked}</p>
      ) : conversationId ? (
        <div className="space-y-4">
          <p className="rounded border border-border-strong bg-surface-2 px-4 py-3 text-ui">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green align-middle" aria-hidden />
            {avatar.name} is on the way. It usually appears within a minute - admit it from the
            meeting&apos;s waiting room if the host has one.
          </p>
          <p className="text-label text-text-faint">
            The conversation is saved in Conversations. The avatar leaves on its own at its maximum call length.
          </p>
          <div className="flex justify-end">
            <Button variant="danger" onClick={() => leave.mutate()} disabled={leave.isPending}>
              {leave.isPending ? "Removing…" : "Remove from meeting"}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-ui font-medium">Meeting link</span>
            <input
              type="url"
              required
              autoFocus
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder="https://us06web.zoom.us/j/12345678901?pwd=…"
              className="h-10 w-full rounded border border-border bg-bg px-3 text-ui text-text outline-none focus:border-border-strong"
            />
          </label>
          <p className="text-label text-text-faint">Zoom, Google Meet, Microsoft Teams or Webex.</p>
          <div className="flex justify-end">
            <Button type="submit" disabled={invite.isPending || !meetingUrl.trim()}>
              <VideoIcon />
              {invite.isPending ? "Sending invite…" : "Invite to meeting"}
            </Button>
          </div>
        </form>
      )}

      {error && <p className="mt-4 text-ui text-red">{error.message}</p>}
    </Modal>
  );
}

/* ------------------------------------------------------------------------ */

function Row({ icon, title, description, action, footer }) {
  return (
    <section className="rounded-[20px] border border-border bg-surface-2 px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-surface-3 text-text-muted">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-ui font-semibold">{title}</h3>
          <div className="mt-0.5 text-ui text-text-muted">{description}</div>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
      {footer && <div className="mt-3">{footer}</div>}
    </section>
  );
}

function CopyButton({ text, label, copiedLabel = "Copied", variant = "secondary", fullWidth = false }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions).
      setFailed(true);
    }
  };

  return (
    <>
      <Button variant={variant} fullWidth={fullWidth} onClick={copy}>
        <CopyIcon />
        {copied ? copiedLabel : label}
      </Button>
      {failed && <p className="mt-2 text-label text-red">Could not copy - your browser blocked the clipboard.</p>}
    </>
  );
}

/* ------------------------------------------------------------------------ */

const stroke = {
  width: 18,
  height: 18,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

function CopyIcon() {
  return (
    <svg {...stroke} width={16} height={16}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
    </svg>
  );
}

function WidgetIcon() {
  return (
    <svg {...stroke}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <rect x="8.5" y="8" width="3.5" height="3" rx="0.8" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg {...stroke} width={16} height={16}>
      <rect x="2" y="4.5" width="8.5" height="7" rx="1.5" />
      <path d="m10.5 7 3.5-2v6l-3.5-2" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg {...stroke}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5v3.5M8 5h.01" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg {...stroke}>
      <path d="M6.5 9.5 9.5 6.5" />
      <path d="M7 4.5 8.2 3.3a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8" />
    </svg>
  );
}
