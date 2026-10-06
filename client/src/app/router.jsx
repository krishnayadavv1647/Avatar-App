import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";
import RequireAuth from "./RequireAuth";
import SignIn from "@/features/auth/SignIn";
import Home from "@/features/dashboard/Home";
import AvatarList from "@/features/avatars/AvatarList";
import AvatarDetail from "@/features/avatars/AvatarDetail";
import AvatarCreator from "@/features/studio/AvatarCreator";
import CallRoom from "@/features/call/CallRoom";
import TalkPage from "@/features/talk/TalkPage";
import Usage from "@/features/analytics/Usage";
import OAuthConsent from "@/features/connect/OAuthConsent";
import ConnectAiTools from "@/features/connect/ConnectAiTools";
import ConversationList from "@/features/conversations/ConversationList";
import ConversationDetail from "@/features/conversations/ConversationDetail";
import DesignPreview from "@/features/_design/DesignPreview";
import AdminOverview from "@/features/admin/AdminOverview";
import AdminUser from "@/features/admin/AdminUser";
import AdminPlans from "@/features/admin/AdminPlans";

/**
 * Signed-in pages live inside the shell; sign-in and the avatar creator do not.
 *
 * The creator is deliberately outside: it wants the whole window. The call
 * room used to be too, and now sits in the shell like LemonSlice's avatar page.
 */
const app = (element, { wide = false } = {}) => (
  <RequireAuth>
    <AppShell wide={wide}>{element}</AppShell>
  </RequireAuth>
);

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<SignIn mode="login" />} />
      <Route path="/register" element={<SignIn mode="register" />} />

      {/* Public: anyone with an avatar's share link, no account needed. */}
      <Route path="/talk/:token" element={<TalkPage />} />
      <Route path="/embed/:token" element={<TalkPage embedded />} />

      <Route path="/" element={app(<Home />, { wide: true })} />
      <Route path="/avatars" element={app(<AvatarList />)} />
      <Route path="/avatars/:id" element={app(<AvatarDetail />, { wide: true })} />
      <Route
        path="/studio"
        element={
          <RequireAuth>
            <AvatarCreator />
          </RequireAuth>
        }
      />
      <Route path="/analytics" element={app(<Usage />)} />
      {/* Where a connector (Claude, ChatGPT) sends the browser to ask permission. */}
      <Route
        path="/oauth/authorize"
        element={
          <RequireAuth>
            <OAuthConsent />
          </RequireAuth>
        }
      />
      <Route path="/connect" element={app(<ConnectAiTools />)} />
      <Route path="/conversations" element={app(<ConversationList />)} />
      <Route path="/conversations/:id" element={app(<ConversationDetail />)} />

      {/* Platform admins only; the pages check, and the API checks again. */}
      <Route path="/admin" element={app(<AdminOverview />)} />
      <Route path="/admin/users/:id" element={app(<AdminUser />)} />
      <Route path="/admin/plans" element={app(<AdminPlans />)} />

      <Route path="/call/:avatarId" element={app(<CallRoom />, { wide: true })} />

      {/* Reference surface for the design system; not part of the product. */}
      <Route path="/_design" element={<DesignPreview />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
