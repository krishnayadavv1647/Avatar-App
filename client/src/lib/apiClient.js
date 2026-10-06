import { useAuth } from "@/store/auth.store";

const BASE = import.meta.env.VITE_API_BASE || "/api";

/** The API's full address, even when BASE is a relative path. */
export const apiUrl = (path) => new URL(`${BASE}${path}`, window.location.href).href;

/**
 * Fetch wrapper that attaches the access token and recovers from expiry.
 *
 * Access tokens are deliberately short-lived, so a 401 mid-session is normal
 * rather than exceptional: it is retried once behind a single shared refresh,
 * and only a failed refresh signs the user out. Sharing that one refresh
 * matters - a page issuing six parallel requests would otherwise fire six
 * refreshes and invalidate its own tokens in the race.
 */
let refreshing = null;

async function refreshTokens() {
  const { refreshToken, setTokens, clear } = useAuth.getState();
  if (!refreshToken) return false;

  refreshing ||= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.error?.code === "account_blocked") {
          clear();
          window.location.assign("/login?blocked=1");
        }
        throw new Error("refresh failed");
      }

      const body = await res.json();
      setTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken });
      return true;
    } catch {
      clear();
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

async function send(path, { method = "GET", body, form } = {}) {
  const { accessToken } = useAuth.getState();

  const headers = {
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    // FormData sets its own content-type, including the multipart boundary.
    ...(body ? { "content-type": "application/json" } : {}),
  };

  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
}

async function request(path, options = {}) {
  let res = await send(path, options);

  if (res.status === 401 && (await refreshTokens())) {
    res = await send(path, options);
  }

  const text = await res.text();
  let payload = null;
  let json = true;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    json = false;
  }

  // The API always answers in JSON, and only a 204 has no body. An empty or
  // HTML "success" means the request never reached the API - typically the web
  // app is hosted apart from it and VITE_API_BASE still points at its own
  // host. Saying so beats a "cannot destructure null" further up the page.
  if (res.ok && res.status !== 204 && (!json || payload === null)) {
    const error = new Error(
      `No API answered at ${new URL(`${BASE}${path}`, window.location.href).href} ` +
        `(got ${json ? "an empty response" : "a web page"}, status ${res.status}). ` +
        `If the web app and the API are hosted separately, set VITE_API_BASE to the API's full address and rebuild.`,
    );
    error.status = res.status;
    throw error;
  }

  if (!res.ok) {
    // A blocked account is signed out on the spot rather than left on pages
    // where every request fails. Only mid-session: on the sign-in form the
    // message is simply shown.
    if (payload?.error?.code === "account_blocked" && useAuth.getState().accessToken) {
      useAuth.getState().clear();
      window.location.assign("/login?blocked=1");
    }

    // "Validation failed" alone tells nobody what to fix; the details do.
    const details = payload?.error?.details;
    const message = details?.length
      ? details.map((d) => d.message).join(". ")
      : payload?.error?.message || `Request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    throw error;
  }

  return payload;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  del: (path) => request(path, { method: "DELETE" }),
  upload: (path, form) => request(path, { method: "POST", form }),
};
