import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { authApi } from "@/services/auth.api";
import { useAuth } from "@/store/auth.store";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import GoogleButton from "./GoogleButton";

/**
 * Sign in and sign up share a form because they differ by one field and one
 * endpoint; two near-identical components would drift.
 *
 * Rendered outside the app shell - there is no navigation to offer someone who
 * is not signed in.
 */
export default function SignIn({ mode = "login" }) {
  const isRegister = mode === "register";
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuth((s) => s.setSession);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      isRegister
        ? authApi.register({ email, password, name: name || undefined })
        : authApi.login({ email, password }),
    onSuccess: (session) => {
      setSession(session);
      // Return them to whatever they were trying to reach.
      navigate(location.state?.from || "/", { replace: true });
    },
  });

  const google = useMutation({
    mutationFn: authApi.google,
    onSuccess: (session) => {
      setSession(session);
      navigate(location.state?.from || "/", { replace: true });
    },
  });

  const canSubmit =email.trim() && password.length >= (isRegister ? 10 : 1) && !submit.isPending;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-gutter py-16">
      <div className="mb-8 flex items-center gap-2">
        <img src="/logo.png" alt="" aria-hidden className="h-8 w-8 shrink-0 object-contain" />
        <span className="font-medium">Avatar Studio</span>
      </div>

      <h1>{isRegister ? "Create your workspace" : "Sign in"}</h1>
      <p className="mt-2 text-text-muted">
        {isRegister
          ? "One account, one workspace, avatars you can call."
          : "Welcome back."}
      </p>

      {new URLSearchParams(location.search).has("blocked") && (
        <p className="mt-6 rounded border border-red-line bg-red-dim px-4 py-3 text-ui text-red">
          This account has been blocked. Contact support if you think this is a mistake.
        </p>
      )}

      <Card className="mt-8">
        <GoogleButton
          onCredential={(credential) => google.mutate(credential)}
          disabled={google.isPending || submit.isPending}
          label={isRegister ? "signup_with" : "continue_with"}
        />
        {google.isError && (
          <p className="-mt-2 mb-5 rounded border border-red-line bg-red-dim px-4 py-3 text-ui text-red">
            {google.error.message}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) submit.mutate();
          }}
        >
          {isRegister && (
            <Field label="Name" value={name} onChange={setName} placeholder="Krishna" />
          )}

          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
          />

          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={isRegister ? "new-password" : "current-password"}
            hint={isRegister ? "At least 10 characters" : undefined}
          />

          {submit.isError && (
            <p className="mt-5 rounded border border-red-line bg-red-dim px-4 py-3 text-ui text-red">
              {submit.error.message}
            </p>
          )}

          <div className="mt-6">
            <Button type="submit" size="lg" disabled={!canSubmit} fullWidth>
              {submit.isPending ? "Working…" : isRegister ? "Create account" : "Sign in"}
            </Button>
          </div>
        </form>
      </Card>

      <p className="mt-6 text-ui text-text-muted">
        {isRegister ? "Already have an account? " : "No account yet? "}
        <Link to={isRegister ? "/login" : "/register"} className="text-pink hover:underline">
          {isRegister ? "Sign in" : "Create one"}
        </Link>
      </p>
    </main>
  );
}
