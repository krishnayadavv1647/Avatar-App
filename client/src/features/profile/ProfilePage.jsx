import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { profileApi } from "@/services/profile.api";
import { useAuth } from "@/store/auth.store";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import UserAvatar from "@/components/common/UserAvatar";
import Field from "@/components/forms/Field";
import { Badge, Label, Select } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";

/**
 * The signed-in person's own page: who they are, their picture, the workspace
 * they are in, and their password. Each card saves on its own Save button, and
 * a saved name or picture shows in the sidebar straight away.
 */
const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" };
const ROLE_TONE = { owner: "purple", admin: "blue", member: "neutral" };
const MIN_PASSWORD = 10;

const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "-");

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const setUser = useAuth((s) => s.setUser);
  const { data, isLoading, error } = useQuery({ queryKey: ["profile"], queryFn: profileApi.get });
  const profile = data?.profile;

  /** Every save answers with the whole profile: keep the page and the sidebar in step with it. */
  const adopt = ({ profile: next }) => {
    queryClient.setQueryData(["profile"], { profile: next });
    setUser({ name: next.name, photoUrl: next.photoUrl, role: next.role });
  };

  // The role can change under them (an owner promotes them); the sidebar follows what the server says.
  useEffect(() => {
    if (profile) setUser({ name: profile.name, photoUrl: profile.photoUrl, role: profile.role });
  }, [profile, setUser]);

  if (isLoading) return <p className="text-text-muted">Loading…</p>;
  if (error) return <p className="text-red">{error.message}</p>;

  return (
    <>
      <PageHeader title="Profile" description="Your details, your picture and your password." />
      <div className="space-y-4">
        <PhotoCard profile={profile} onChange={adopt} />
        <DetailsCard key={profile.id} profile={profile} onSaved={adopt} />
        <WorkspaceCard key={`w-${profile.workspace?.id}`} profile={profile} onSaved={adopt} />
        <PasswordCard profile={profile} />
      </div>
    </>
  );
}

function PhotoCard({ profile, onChange }) {
  const input = useRef(null);

  const upload = useMutation({
    mutationFn: (file) => profileApi.setPhoto(file),
    onSuccess: (res) => {
      onChange(res);
      toast.success("Picture updated");
    },
    onError: (err) => toast.error(err.message),
  });
  const remove = useMutation({
    mutationFn: profileApi.removePhoto,
    onSuccess: (res) => {
      onChange(res);
      toast.success("Picture removed");
    },
    onError: (err) => toast.error(err.message),
  });
  const busy = upload.isPending || remove.isPending;

  const pick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("That picture is over 5 MB");
    upload.mutate(file);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-5">
        <UserAvatar user={profile} size={88} />
        <div className="min-w-0 flex-1 basis-56">
          <p className="flex flex-wrap items-center gap-2 text-h3 font-medium">
            <span className="truncate">{profile.name || profile.email}</span>
            <Badge tone={ROLE_TONE[profile.role]}>{ROLE_LABEL[profile.role]}</Badge>
          </p>
          <p className="mt-1 truncate text-ui text-text-muted">{profile.email}</p>
          {profile.title && <p className="truncate text-ui text-text-faint">{profile.title}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} className="hidden" aria-label="Choose a picture" />
            <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
              {upload.isPending ? "Uploading…" : profile.photoUrl ? "Change picture" : "Add a picture"}
            </Button>
            {profile.photoUrl && (
              <Button size="sm" variant="ghost" onClick={() => remove.mutate()} disabled={busy}>
                Remove
              </Button>
            )}
          </div>
          <p className="mt-2 text-label text-text-faint">JPG, PNG or WebP, up to 5 MB.</p>
        </div>
      </div>
    </Card>
  );
}

/** Every zone this browser knows, with the person's own first so it is easy to find. */
function useTimezones(current) {
  return useMemo(() => {
    let zones = [];
    try {
      zones = Intl.supportedValuesOf("timeZone");
    } catch {
      zones = ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles"];
    }
    const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const extra = [current, mine].filter((z) => z && !zones.includes(z));
    return { zones: [...extra, ...zones], mine };
  }, [current]);
}

function DetailsCard({ profile, onSaved }) {
  const [form, setForm] = useState({ name: profile.name, title: profile.title, phone: profile.phone, timezone: profile.timezone });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const { zones, mine } = useTimezones(profile.timezone);

  const changed = ["name", "title", "phone", "timezone"].some((k) => form[k] !== profile[k]);
  const save = useMutation({
    mutationFn: () => profileApi.update({ name: form.name.trim(), title: form.title.trim(), phone: form.phone.trim(), timezone: form.timezone }),
    onSuccess: (res) => {
      onSaved(res);
      toast.success("Profile saved");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card title="Personal details">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim()) return toast.error("Your name is required");
          save.mutate();
        }}
        noValidate
      >
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <Field label="Full name" id="profile-name" value={form.name} onChange={(name) => set({ name })} maxLength={80} autoComplete="name" />
          </div>
          <div>
            <Field label="Job title" id="profile-title" value={form.title} onChange={(title) => set({ title })} maxLength={80} placeholder="Head of support" autoComplete="organization-title" />
          </div>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <Field label="Phone" id="profile-phone" type="tel" value={form.phone} onChange={(phone) => set({ phone })} maxLength={30} placeholder="+91 98765 43210" autoComplete="tel" />
          </div>
          <div>
            <Label htmlFor="profile-timezone">Time zone</Label>
            <Select id="profile-timezone" value={form.timezone} onChange={(timezone) => set({ timezone })}>
              <option value="">Not set</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
            {form.timezone !== mine && (
              <button type="button" onClick={() => set({ timezone: mine })} className="mt-2 text-label text-text-muted underline-offset-2 hover:text-text hover:underline">
                Use this device's: {mine}
              </button>
            )}
          </div>
        </div>

        <div className="mt-5">
          <Field label="Email" id="profile-email" value={profile.email} onChange={() => {}} disabled readOnly hint="Your sign-in. It cannot be changed here." />
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button type="submit" disabled={!changed || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {!changed && !save.isPending && <span className="text-label text-text-faint">Member since {day(profile.createdAt)}</span>}
        </div>
      </form>
    </Card>
  );
}

function WorkspaceCard({ profile, onSaved }) {
  const [name, setName] = useState(profile.workspace?.name || "");
  const isOwner = profile.role === "owner";
  const runsIt = isOwner || profile.role === "admin";

  const save = useMutation({
    mutationFn: () => profileApi.update({ workspaceName: name.trim() }),
    onSuccess: (res) => {
      onSaved(res);
      toast.success("Workspace renamed");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card title="Workspace">
      <p className="mt-2 text-ui text-text-muted">
        You are {profile.role === "admin" ? "an" : "a"} {ROLE_LABEL[profile.role].toLowerCase()} here. Everyone in a workspace shares its avatars, plan and credits.
      </p>
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save.mutate();
        }}
        noValidate
      >
        <Field
          label="Workspace name"
          id="workspace-name"
          value={name}
          onChange={setName}
          maxLength={80}
          disabled={!isOwner}
          hint={isOwner ? undefined : "Only the owner can rename the workspace."}
        />
        {isOwner && (
          <div className="mt-5">
            <Button type="submit" disabled={!name.trim() || name.trim() === profile.workspace?.name || save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </form>
      {runsIt && (
        <p className="mt-5 text-ui text-text-muted">
          <Link to="/team" className="font-medium text-text underline-offset-2 hover:underline">
            Manage your team
          </Link>{" "}
          to add people to this workspace.
        </p>
      )}
    </Card>
  );
}

function PasswordCard({ profile }) {
  const setTokens = useAuth((s) => s.setTokens);
  const empty = { current: "", next: "", again: "" };
  const [form, setForm] = useState(empty);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const mismatch = form.again !== "" && form.next !== form.again;
  const ready = form.next.length >= MIN_PASSWORD && form.next === form.again && (!profile.hasPassword || form.current !== "");

  const change = useMutation({
    mutationFn: () => profileApi.changePassword({ ...(profile.hasPassword && { currentPassword: form.current }), newPassword: form.next }),
    onSuccess: (res) => {
      // This device gets fresh tokens so it stays signed in; every other one is signed out.
      setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
      setForm(empty);
      toast.success("Password updated. Other devices were signed out.");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card title="Password">
      <p className="mt-2 text-ui text-text-muted">
        {profile.hasPassword
          ? "Changing it signs you out of every other device."
          : "You sign in with Google. Set a password to also be able to sign in with your email."}
      </p>
      <form
        className="mt-4 max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) change.mutate();
        }}
        noValidate
      >
        {profile.hasPassword && (
          <Field label="Current password" id="pw-current" type="password" value={form.current} onChange={(current) => set({ current })} autoComplete="current-password" />
        )}
        <Field
          label="New password"
          id="pw-new"
          type="password"
          value={form.next}
          onChange={(next) => set({ next })}
          hint={`At least ${MIN_PASSWORD} characters. A long phrase works well.`}
          autoComplete="new-password"
        />
        <Field
          label="New password again"
          id="pw-again"
          type="password"
          value={form.again}
          onChange={(again) => set({ again })}
          hint={mismatch ? "These do not match yet." : undefined}
          autoComplete="new-password"
        />
        <div className="mt-5">
          <Button type="submit" disabled={!ready || change.isPending}>
            {change.isPending ? "Updating…" : profile.hasPassword ? "Update password" : "Set password"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
