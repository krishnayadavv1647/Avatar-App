import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { joinApi } from "@/services/team.api";
import { useAuth } from "@/store/auth.store";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import { Badge } from "@/components/forms/controls";
import { useBranding } from "@/hooks/useBranding";

/**
 * What opens from a workspace invite link: who invited you, where you would
 * join and as what, and a form to make your account. It creates a new account
 * inside that workspace and signs it in. Outside the app shell, like sign-in.
 *
 * A person belongs to one workspace, so the link cannot move an existing
 * account into this one; the page says so rather than failing late.
 */
const MIN_PASSWORD = 10;
const ROLE_LABEL = { admin: "an admin", member: "a member" };

export default function JoinPage() {
  const { token } = useParams();
  const brand = useBranding();
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const signedIn = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);

  const { data: invite, isLoading, error } = useQuery({
    queryKey: ["join", token],
    queryFn: () => joinApi.describe(token),
    retry: false,
  });

  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const email = invite?.email || form.email;

  const join = useMutation({
    mutationFn: () => joinApi.join(token, { name: form.name.trim(), email: email.trim(), password: form.password }),
    onSuccess: (session) => {
      setSession(session);
      navigate("/", { replace: true });
    },
  });

  const canSubmit = form.name.trim() && email.trim() && form.password.length >= MIN_PASSWORD && !join.isPending;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-gutter py-16">
      <div className="mb-8 flex items-center gap-2">
        <img src={brand.logoUrl} alt="" aria-hidden className="h-8 w-8 shrink-0 object-contain" />
        <span className="font-medium">{brand.name}</span>
      </div>

      {isLoading && <p className="text-text-muted">Checking your invite…</p>}

      {error && (
        <>
          <h1>This invite does not work</h1>
          <p className="mt-2 text-text-muted">{error.message}</p>
          <p className="mt-6 text-ui text-text-muted">
            Ask the person who invited you for a new link, or{" "}
            <Link to="/login" className="text-pink hover:underline">
              sign in
            </Link>{" "}
            if you already have an account.
          </p>
        </>
      )}

      {invite && (
        <>
          <h1>Join {invite.workspace}</h1>
          <p className="mt-2 text-text-muted">
            {invite.invitedBy ? `${invite.invitedBy} invited you` : "You are invited"} to join as {ROLE_LABEL[invite.role]}. You will share its avatars and credits.
          </p>

          {signedIn ? (
            <Card className="mt-8">
              <p className="text-ui text-text-muted">
                You are signed in as <span className="font-medium text-text">{signedIn.email}</span>. An invite makes a new account, so sign out of this one first.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={clear}>Sign out and continue</Button>
                <Button variant="ghost" onClick={() => navigate("/")}>
                  Stay signed in
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="mt-8">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canSubmit) join.mutate();
                }}
              >
                <Field label="Your name" id="join-name" value={form.name} onChange={(name) => set({ name })} placeholder="Asha Rao" maxLength={80} autoComplete="name" autoFocus />
                <Field
                  label="Email"
                  id="join-email"
                  type="email"
                  value={email}
                  onChange={(v) => set({ email: v })}
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={Boolean(invite.email)}
                  hint={invite.email ? "This invite is for this address." : undefined}
                />
                <Field
                  label="Choose a password"
                  id="join-password"
                  type="password"
                  value={form.password}
                  onChange={(password) => set({ password })}
                  autoComplete="new-password"
                  hint={`At least ${MIN_PASSWORD} characters`}
                />

                {join.isError && (
                  <p className="mt-5 rounded border border-red-line bg-red-dim px-4 py-3 text-ui text-red">{join.error.message}</p>
                )}

                <div className="mt-6">
                  <Button type="submit" size="lg" fullWidth disabled={!canSubmit}>
                    {join.isPending ? "Joining…" : `Join as ${invite.role}`}
                  </Button>
                </div>
              </form>
            </Card>
          )}

          <p className="mt-6 flex flex-wrap items-center gap-2 text-label text-text-faint">
            <Badge tone="outline">One workspace per account</Badge>
            Already have an account here? Ask the owner to add you instead, or use a different email.
          </p>
        </>
      )}
    </main>
  );
}
