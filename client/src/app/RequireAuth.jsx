import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/store/auth.store";

/**
 * Gate for signed-in routes.
 *
 * Client-side only, and not a security boundary - the API rejects unauthorised
 * requests regardless. This exists so a signed-out visitor sees the sign-in
 * form instead of a page full of failed requests.
 */
export default function RequireAuth({ children }) {
  const accessToken = useAuth((s) => s.accessToken);
  const location = useLocation();

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}
