import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invitationApi } from "@/services/admin.users.api";
import { useAuth } from "@/store/auth.store";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import { Badge } from "@/components/forms/controls";
import { date } from "@/features/admin/format";

/**
 * /invite/:token - where the link in an invitation email lands. Public: it
 * has to render before anyone has an account.
 *
 * It says who invited to what, then walks the person through the one thing
 * left: sign in (or sign up) with the invited address, and accept. Signing in
 * or up returns here, so the link keeps working as the whole flow.
 */
export default function InvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuth((s) => s.user);
  const signedIn = useAuth((s) => Boolean(s.accessToken));
  const clearSession = useAuth((s) => s.clear);

  const { data: invitation, error, isLoading } = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => invitationApi.describe(token),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => invitationApi.accept(token),
    // The plan, and maybe the role, just changed: nothing cached is trustworthy.
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const here = { from: `/invite/${token}` };
  const wrongAccount = invitation && signedIn && user?.email && user.email.toLowerCase() !== invitation.email.toLowerCase();

  const switchAccount = () => {
    clearSession();
    navigate("/login", { state: here });
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-gutter py-16">
      <div className="mb-8 flex items-center gap-2">
        <img src="/logo.png" alt="" aria-hidden className="h-8 w-8 shrink-0 object-contain" />
        <span className="font-medium">Avatar Studio</span>
      </div>

      {isLoading && <p className="text-text-muted">Opening your invitation…</p>}

      {error && (
        <>
          <h1>Invitation unavailable</h1>
          <p className="mt-3 rounded border border-red-line bg-red-dim px-4 py-3 text-ui text-red">{error.message}</p>
          <Link to="/" className="mt-6 text-ui text-pink hover:underline">
            Go to Avatar Studio
          </Link>
        </>
      )}

      {invitation && accept.isSuccess && (
        <>
          <h1>{accept.data.alreadyAccepted ? "Already accepted" : "You're all set"}</h1>
          <p className="mt-2 text-text-muted">
            {accept.data.alreadyAccepted
              ? "This invitation was already used."
              : `Your account is now on the ${accept.data.planName} plan.`}
          </p>
          <Button className="mt-8" size="lg" onClick={() => navigate("/", { replace: true })}>
            Open Avatar Studio
          </Button>
        </>
      )}

      {invitation && !accept.isSuccess && invitation.status === "accepted" && (
        <>
          <h1>Already accepted</h1>
          <p className="mt-2 text-text-muted">This invitation was already used.</p>
          <Link to="/" className="mt-6 text-ui text-pink hover:underline">
            Open Avatar Studio
          </Link>
        </>
      )}

      {invitation && !accept.isSuccess && invitation.status === "pending" && (
        <>
          <h1>You're invited</h1>
          <p className="mt-2 text-text-muted">
            Join Avatar Studio on the plan below. It activates the moment you accept.
          </p>

          <Card className="mt-8">
            <dl className="space-y-4 text-ui">
              <Row label="Plan">
                <span className="font-medium">{invitation.plan?.name || "—"}</span>
                {invitation.plan && (
                  <span className="ml-2 text-text-muted">
                    {invitation.plan.includedMinutes > 0
                      ? `${invitation.plan.includedMinutes.toLocaleString()} minutes a month`
                      : "no monthly minute cap"}
                  </span>
                )}
              </Row>
              <Row label="Role">
                <Badge tone="outline" className="capitalize">
                  {invitation.role}
                </Badge>
              </Row>
              <Row label="Sent to">{invitation.email}</Row>
              <Row label="Expires">{date(invitation.expiresAt)}</Row>
              {invitation.message && <Row label="Message">{invitation.message}</Row>}
            </dl>
          </Card>

          <div className="mt-6">
            {!signedIn && (
              <>
                <p className="mb-4 text-ui text-text-muted">
                  Sign in or create an account with <strong className="text-text">{invitation.email}</strong> to accept.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button as={Link} to="/login" state={here} size="lg" fullWidth>
                    Sign in
                  </Button>
                  <Button as={Link} to="/register" state={here} variant="secondary" size="lg" fullWidth>
                    Create account
                  </Button>
                </div>
              </>
            )}

            {signedIn && wrongAccount && (
              <>
                <p className="mb-4 rounded border border-red-line bg-red-dim px-4 py-3 text-ui text-red">
                  This invitation was sent to {invitation.email}, but you are signed in as {user.email}.
                </p>
                <Button size="lg" variant="secondary" fullWidth onClick={switchAccount}>
                  Sign in with {invitation.email}
                </Button>
              </>
            )}

            {signedIn && !wrongAccount && (
              <>
                {accept.isError && (
                  <p className="mb-4 rounded border border-red-line bg-red-dim px-4 py-3 text-ui text-red">
                    {accept.error.message}
                  </p>
                )}
                <Button size="lg" fullWidth onClick={() => accept.mutate()} disabled={accept.isPending}>
                  {accept.isPending ? "Accepting…" : "Accept invitation"}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
