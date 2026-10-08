import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { teamApi } from "@/services/team.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import { Label, Select } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { CopyLine } from "./password.jsx";

const ROLE_LABEL = { admin: "Admin", member: "Member" };
const EXPIRY = [
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
];
const USES = [
  { value: 1, label: "One person" },
  { value: 5, label: "Up to 5 people" },
  { value: 25, label: "Up to 25 people" },
  { value: 50, label: "Up to 50 people" },
];

/**
 * "Invite by link": makes a link anyone can open to create their own account
 * inside this workspace. The link is shown once - only a hash is kept - so the
 * dialog ends on it, to be copied.
 */
export default function InviteLinkDialog({ open, roles, onClose, onCreated }) {
  const fresh = () => ({ role: roles.at(-1), expiresInDays: 7, maxUses: 1, email: "" });
  const [form, setForm] = useState(fresh);
  const [made, setMade] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const create = useMutation({
    mutationFn: () =>
      teamApi.createInvite({
        role: form.role,
        expiresInDays: Number(form.expiresInDays),
        maxUses: Number(form.maxUses),
        ...(form.email.trim() && { email: form.email.trim() }),
      }),
    onSuccess: (res) => {
      setMade(res);
      onCreated();
    },
    onError: (err) => toast.error(err.message),
  });

  const close = () => {
    if (create.isPending) return;
    setMade(null);
    setForm(fresh());
    onClose();
  };

  if (made) {
    const { invite, link } = made;
    return (
      <Modal
        open={open}
        onClose={close}
        title="Invite link ready"
        description="Send it to the person you are inviting. For safety it is shown only now - make another if you lose it."
        footer={<Button onClick={close}>Done</Button>}
      >
        <div className="space-y-4">
          <CopyLine label="Invite link" value={link} />
          <p className="text-label text-text-faint">
            Joins as {ROLE_LABEL[invite.role].toLowerCase()} · {invite.email ? `only for ${invite.email}` : invite.maxUses === 1 ? "works once" : `works ${invite.maxUses} times`} · expires{" "}
            {new Date(invite.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite by link"
      description="Anyone who opens the link can create their own account inside this workspace. You do not need to know their password."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? "Making…" : "Make link"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="invite-role">Joins as</Label>
          <Select id="invite-role" value={form.role} onChange={(role) => set({ role })}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="invite-expiry">Expires after</Label>
          <Select id="invite-expiry" value={form.expiresInDays} onChange={(expiresInDays) => set({ expiresInDays })}>
            {EXPIRY.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-5">
        <Label htmlFor="invite-uses">Who can use it</Label>
        <Select id="invite-uses" value={form.email.trim() ? 1 : form.maxUses} onChange={(maxUses) => set({ maxUses })} disabled={Boolean(form.email.trim())}>
          {USES.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-5">
        <Field
          label="Only this email (optional)"
          id="invite-email"
          type="email"
          value={form.email}
          onChange={(email) => set({ email })}
          placeholder="asha@company.com"
          hint="Locks the link to one address, so it is useless if it is forwarded."
          autoComplete="off"
        />
      </div>
    </Modal>
  );
}
