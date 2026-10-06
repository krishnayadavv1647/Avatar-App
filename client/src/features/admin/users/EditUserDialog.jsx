import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { adminUsersApi } from "@/services/admin.users.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Field from "@/components/forms/Field";
import { Badge, Label, Select, TextArea } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { money } from "../format";
import UserCreditsCard from "./UserCreditsCard";
import { planCreditsLabel } from "./userUi";

const startingForm = (user) => ({
  name: user.name || "",
  organization: user.organization || "",
  status: user.status,
  role: user.role,
  planId: user.planId ? String(user.planId) : "",
  blockReason: "",
});

/**
 * "Edit User": profile, status and role, and the plan - one
 * save. Only what changed is sent. Moving someone to a plan applies it from
 * their next call and emails them (when mail is set up).
 *
 * Rendered with `key={user.id}` by its parent, so the form starts from each
 * user afresh.
 */
export default function EditUserDialog({ user, plans, onClose, onSaved }) {
  const [form, setForm] = useState(() => startingForm(user));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const selectable = plans.filter((p) => p.active || String(p._id) === form.planId);
  const selectedPlan = plans.find((p) => String(p._id) === form.planId);
  const suspending = form.status === "suspended" && user.status !== "suspended";

  const changes = () => {
    const out = {};
    if (form.name.trim() !== (user.name || "")) out.name = form.name.trim();
    if (form.organization.trim() !== (user.organization || "")) out.organization = form.organization.trim();
    if (form.status !== user.status) out.status = form.status;
    if (form.role !== user.role) out.role = form.role;
    if (form.planId && form.planId !== String(user.planId || "")) out.planId = form.planId;
    if (suspending && form.blockReason.trim()) out.blockReason = form.blockReason.trim();
    return out;
  };

  const save = useMutation({
    mutationFn: (fields) => adminUsersApi.update(user.id, fields),
    onSuccess: ({ planEmail }) => {
      toast.success("User updated successfully!");
      if (planEmail === "sent") toast.success("Plan update email sent to user!");
      // "skipped" is mail not being set up, which is not worth a message.
      if (planEmail === "failed") toast.info("User updated but plan email failed to send.");
      onSaved();
    },
    onError: (error) => toast.error("Failed to update user.", { description: error.message }),
  });

  const submit = (e) => {
    e.preventDefault();
    const fields = changes();
    if (!Object.keys(fields).length) {
      onClose();
      return;
    }
    save.mutate(fields);
  };

  const close = () => !save.isPending && onClose();

  return (
    <Modal
      open
      onClose={close}
      title={`Edit User: ${user.name || user.email}`}
      description="Update user information, plan assignment, and credits."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="edit-user-form" disabled={save.isPending}>
            {save.isPending ? "Updating..." : "Update User"}
          </Button>
        </>
      }
    >
      <form id="edit-user-form" onSubmit={submit} noValidate className="space-y-5">
        <Card title="Basic Information" className="bg-surface-2">
          <div className="mt-4 space-y-5">
            <Field label="Full Name" id="edit-name" value={form.name} onChange={(name) => set({ name })} maxLength={80} />
            <Field label="Email (Read-only)" id="edit-email" value={user.email} onChange={() => {}} readOnly />
            <Field
              label="Organization"
              id="edit-organization"
              value={form.organization}
              onChange={(organization) => set({ organization })}
              maxLength={120}
            />

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="edit-status">Status</Label>
                <Select id="edit-status" value={form.status} onChange={(status) => set({ status })}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-role" hint={user.superAdmin ? "Listed in ADMIN_EMAILS, so always an admin." : undefined}>
                  Role
                </Label>
                <Select id="edit-role" value={form.role} onChange={(role) => set({ role })} disabled={user.superAdmin}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </Select>
              </div>
            </div>

            {suspending && (
              <div>
                <Label htmlFor="edit-reason" hint="Only admins see it. They are signed out everywhere and their live calls end.">
                  Reason for suspending (optional)
                </Label>
                <TextArea
                  id="edit-reason"
                  rows={2}
                  maxLength={300}
                  value={form.blockReason}
                  onChange={(blockReason) => set({ blockReason })}
                  placeholder="Spam, abuse, unpaid invoice…"
                />
              </div>
            )}

            <div>
              <Label htmlFor="edit-plan-credits">Plan credits</Label>
              <input
                id="edit-plan-credits"
                readOnly
                value={selectedPlan ? planCreditsLabel(selectedPlan) : "No plan"}
                className="h-10 w-full rounded border border-border bg-bg px-3 text-ui text-text opacity-60 outline-none"
              />
              <p className="mt-1.5 text-label text-text-faint">What the assigned plan adds to their balance each month</p>
            </div>
          </div>
        </Card>

        <UserCreditsCard userId={user.id} />

        <Card title="Plan Assignment" className="bg-surface-2">
          <p className="mt-1 text-label text-text-faint">
            A user is on one plan. Choosing another applies it from their next call.
          </p>
          <div role="radiogroup" aria-label="Plan" className="mt-4 max-h-60 space-y-2 overflow-y-auto rounded-lg border border-border bg-bg p-3">
            {selectable.length === 0 && <p className="text-ui text-text-muted">No active plans yet. Create one in the Plans tab.</p>}
            {selectable.map((plan) => {
              const checked = String(plan._id) === form.planId;
              return (
                <label
                  key={plan._id}
                  className={clsx(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                    checked ? "border-border-strong bg-surface-active" : "border-transparent hover:bg-surface-hover",
                  )}
                >
                  <input
                    type="radio"
                    name="edit-plan"
                    checked={checked}
                    onChange={() => set({ planId: String(plan._id) })}
                    className="h-4 w-4 cursor-pointer accent-[color:var(--pink)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui font-medium">
                      {plan.name}
                      {!plan.active && <span className="ml-2 font-normal text-text-faint">(archived)</span>}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-2">
                      <Badge tone="outline">
                        {plan.priceCents ? `${money(plan.priceCents)}${plan.durationType === "lifetime" ? " one time" : "/mo"}` : "Free"}
                      </Badge>
                      <Badge tone="outline">{planCreditsLabel(plan)}</Badge>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </Card>
      </form>
    </Modal>
  );
}
