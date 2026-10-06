import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import { toast } from "@/components/feedback/Toast";
import { date } from "../format";

/**
 * "Invitation Created": whether the email went out, the three facts that
 * matter, and the link - shown now and never again, since only a hash of it is
 * kept. When the email could not be sent, copying the link is the way on.
 */
export default function InvitationCreated({ result, onAnother }) {
  const { invitation, link, emailSent } = result;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invitation link copied!");
    } catch {
      toast.error("Could not copy the link. Select it and copy by hand.");
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <h2 className="flex items-center gap-3 text-h3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-dim text-green" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8.5l3.2 3L13 4.5" />
            </svg>
          </span>
          Invitation Created
        </h2>

        <div className="mt-5 space-y-5">
          {emailSent ? (
            <p className="rounded-lg border border-green bg-green-dim px-4 py-3 text-ui">
              Invitation email sent to <strong>{invitation.email}</strong>. Their plan activates when they open the link and
              accept.
            </p>
          ) : (
            <div className="rounded-lg border border-border-strong bg-surface-2 px-4 py-3 text-ui">
              <p className="font-semibold text-yellow">The email couldn't be sent automatically.</p>
              <p className="mt-1 text-text-muted">Copy the link below and share it with them directly.</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Tile label="Plan" value={invitation.plan?.name || "N/A"} />
            <Tile label="Role" value={invitation.role} capitalize />
            <Tile label="Expires" value={date(invitation.expiresAt)} />
          </div>

          <div className="rounded-lg border border-border bg-surface-2 p-4">
            <h3 className="text-label font-semibold uppercase tracking-wider text-text-faint">Invitation Link</h3>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={link}
                aria-label="Invitation link"
                onFocus={(e) => e.target.select()}
                className="h-10 min-w-0 flex-1 rounded border border-border bg-bg px-3 text-ui text-text outline-none focus:border-border-strong"
              />
              <div className="flex gap-2">
                <Button variant="secondary" onClick={copy}>
                  Copy
                </Button>
                <Button variant="secondary" as="a" href={link} target="_blank" rel="noreferrer" title="Open link" aria-label="Open link">
                  Open
                </Button>
              </div>
            </div>
          </div>

          <div className="flex justify-center">
            <Button onClick={onAnother}>Create Another Invitation</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Tile({ label, value, capitalize = false }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <p className="text-label font-semibold uppercase tracking-wider text-text-faint">{label}</p>
      <p className={capitalize ? "mt-1 text-ui font-medium capitalize" : "mt-1 text-ui font-medium"}>{value}</p>
    </div>
  );
}
