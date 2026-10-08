import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { teamApi } from "@/services/team.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import { Label, Select } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { CopyLine, MIN_PASSWORD, generatePassword } from "./password.jsx";

const ROLE_LABEL = { admin: "Admin", member: "Member" };
const blank = (roles) => ({ name: "", email: "", password: generatePassword(), role: roles.at(-1) });

/**
 * "Add user": makes a real account in this workspace. It can sign in straight
 * away with the email and password set here, so the dialog ends by showing
 * them to be passed on - the password is not shown again afterwards.
 */
export default function AddMemberDialog({ open, roles, onClose, onCreated }) {
  const [form, setForm] = useState(() => blank(roles));
  const [created, setCreated] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const create = useMutation({
    mutationFn: () =>
      teamApi.create({ name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role }),
    onSuccess: ({ member }) => {
      setCreated({ member, password: form.password });
      onCreated();
    },
    onError: (err) => toast.error(err.message),
  });

  const close = () => {
    if (create.isPending) return;
    setCreated(null);
    setForm(blank(roles));
    onClose();
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return toast.error("Name and email are required");
    if (form.password.length < MIN_PASSWORD) return toast.error(`The password needs at least ${MIN_PASSWORD} characters`);
    create.mutate();
  };

  if (created) {
    return (
      <Modal
        open={open}
        onClose={close}
        title="User added"
        description={`${created.member.name} can sign in now. Send them these details - the password will not be shown again.`}
        footer={<Button onClick={close}>Done</Button>}
      >
        <div className="space-y-4">
          <CopyLine label="Email" value={created.member.email} />
          <CopyLine label="Password" value={created.password} />
          <p className="text-label text-text-faint">They can change the password themselves from their profile after signing in.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add user"
      description="They get their own sign-in and work in this workspace, with its avatars and credits."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="add-member-form" disabled={create.isPending}>
            {create.isPending ? "Adding…" : "Add user"}
          </Button>
        </>
      }
    >
      <form id="add-member-form" onSubmit={submit} noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Field label="Full name" id="member-name" value={form.name} onChange={(name) => set({ name })} placeholder="Asha Rao" maxLength={80} autoFocus />
          </div>
          <div>
            <Field
              label="Email"
              id="member-email"
              type="email"
              value={form.email}
              onChange={(email) => set({ email })}
              placeholder="asha@company.com"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="mt-5">
          <Field
            label="Password"
            id="member-password"
            value={form.password}
            onChange={(password) => set({ password })}
            hint={`At least ${MIN_PASSWORD} characters. A strong one is made for you; change it if you like.`}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => set({ password: generatePassword() })}
            className="mt-2 text-ui text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Make another
          </button>
        </div>

        <div className="mt-5 max-w-xs">
          <Label htmlFor="member-role">Role</Label>
          <Select id="member-role" value={form.role} onChange={(role) => set({ role })}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
          <p className="mt-2 text-label text-text-faint">
            {form.role === "admin" ? "Can add and manage members and buy credits." : "Can create and talk to avatars. Cannot manage the team or buy credits."}
          </p>
        </div>
      </form>
    </Modal>
  );
}
