import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { connectionApi } from "@/services/apiKey.api";
import { useAuth } from "@/store/auth.store";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";

/**
 * The permission screen a connector (Claude, ChatGPT, ...) sends the browser
 * to. Sits behind RequireAuth, so a signed-out visitor signs in first and
 * comes back here with the request intact.
 *
 * The app asking and the address it will be sent back to are both shown: the
 * name is whatever the app called itself, so the address is the part to check.
 */
const KEYS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "resource"];

export default function OAuthConsent() {
  const [search] = useSearchParams();
  const user = useAuth((s) => s.user);
  const params = Object.fromEntries(KEYS.filter((k) => search.get(k)).map((k) => [k, search.get(k)]));
  const [sent, setSent] = useState(false);

  const { data, error, isLoading } = useQuery({
    queryKey: ["oauth-request", params],
    queryFn: () => connectionApi.describe(params),
    retry: false,
  });

  const decide = useMutation({
    mutationFn: (allow) => connectionApi.decide(params, allow),
    onSuccess: ({ redirectTo }) => {
      setSent(true);
      window.location.assign(redirectTo);
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <Card className="w-full max-w-md">
        {isLoading && <p className="text-text-muted">Checking the request…</p>}

        {error && (
          <>
            <h1 className="text-h3">Cannot connect</h1>
            <p className="mt-2 text-ui text-red">{error.message}</p>
            <p className="mt-3 text-ui text-text-muted">Go back to the app and start the connection again.</p>
          </>
        )}

        {data && (
          <>
            <h1 className="text-h3">Allow {data.clientName} to use Avatar Studio?</h1>
            <p className="mt-2 text-ui text-text-muted">
              Signed in as {user?.email || "you"}. {data.clientName} will be able to:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-ui text-text-muted">
              <li>see your avatars and their settings</li>
              <li>create and edit avatars</li>
              <li>turn public links on or off</li>
              <li>delete avatars</li>
            </ul>
            <p className="mt-4 text-label text-text-faint">
              You will be sent back to <span className="font-medium text-text-muted">{data.redirectHost}</span>. Only
              allow apps you trust. You can disconnect it any time from AI tools.
            </p>

            {decide.isError && <p className="mt-3 text-ui text-red">{decide.error.message}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => decide.mutate(false)} disabled={decide.isPending || sent}>
                Cancel
              </Button>
              <Button onClick={() => decide.mutate(true)} disabled={decide.isPending || sent}>
                {decide.isPending || sent ? "Connecting…" : "Allow"}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
