import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/services/auth.api";

/**
 * Google's own "Continue with Google" button (Google Identity Services). It
 * hands back an ID token, which the server verifies before signing anyone in.
 *
 * The client id comes from the API rather than a VITE_ variable, so turning
 * Google on is one server setting - no rebuild of the web app. With no id
 * configured the button (and its divider) simply does not appear.
 */
const SCRIPT_SRC = "https://accounts.google.com/gsi/client";
let scriptPromise;

function loadScript() {
  scriptPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load Google sign-in"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export default function GoogleButton({ onCredential, disabled, label = "continue_with" }) {
  const box = useRef(null);
  const handler = useRef(onCredential);
  handler.current = onCredential;
  const [failed, setFailed] = useState(false);

  const { data } = useQuery({ queryKey: ["auth-config"], queryFn: authApi.config, staleTime: Infinity });
  const clientId = data?.googleClientId;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !box.current) return;
        const gis = window.google.accounts.id;
        gis.initialize({
          client_id: clientId,
          callback: (res) => res.credential && handler.current(res.credential),
          ux_mode: "popup",
        });
        box.current.innerHTML = "";
        gis.renderButton(box.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: label,
          logo_alignment: "center",
          width: Math.min(400, box.current.offsetWidth || 320),
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [clientId, label]);

  if (!clientId) return null;

  return (
    <div>
      <div
        ref={box}
        className={disabled ? "pointer-events-none flex justify-center opacity-50" : "flex min-h-[44px] justify-center"}
      />
      {failed && <p className="mt-2 text-center text-ui text-red">Could not load Google sign-in.</p>}
      <div className="my-5 flex items-center gap-3 text-label text-text-faint">
        <span className="h-px flex-1 bg-border" />
        or with email
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
