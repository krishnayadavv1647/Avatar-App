import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { adminUsersApi } from "@/services/admin.users.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import { Label, Select } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { planLabel } from "./userUi";

// Matches the sign-up rule (server auth.validation), so an admin cannot make a weaker account.
const MIN_PASSWORD = 10;

const EMPTY = {
  name: "",
  email: "",
  password: "",
  role: "user",
  status: "active",
  bonusMinutes: "0",
  organization: "",
  planId: "",
};

/**
 * "Create New User": a real account made by an admin - it can sign in with the
 * password set here, gets its own workspace like any sign-up, and is marked as
 * created manually. Bonus minutes sit on top of the plan.
 */
export default function CreateUserDialog({ open, plans, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const create = useMutation({
    mutationFn: () =>
      adminUsersApi.create({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        status: form.status,
        bonusMinutes: Number(form.bonusMinutes) || 0,
        ...(form.organization.trim() && { organization: form.organization.trim() }),
        ...(form.planId && { planId: form.planId }),
      }),
    onSuccess: () => {
      toast.success("User created successfully!");
      setForm(EMPTY);
      onCreated();
    },
    onError: (error) => toast.error(`Failed to create user: ${error.message}`),
  });

  const close = () => {
    if (create.isPending) return;
    setForm(EMPTY);
    onClose();
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.email.trim() || !form.name.trim() || !form.password) {
      toast.error("Email, full name, and password are required");
      return;
    }
    if (form.password.length < MIN_PASSWORD) {
      toast.error(`Password must be at least ${MIN_PASSWORD} characters long`);
      return;
    }
    create.mutate();
  };

  const activePlans = plans.filter((p) => p.active);

  return (
    <Modal
      open={open}
      onClose={close}
      title="Create New User"
      description="They can sign in straight away with this email and password."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="create-user-form" disabled={create.isPending}>
            {create.isPending ? "Creating..." : "Create User"}
          </Button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={submit} noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Field label="Full Name *" value={form.name} onChange={(name) => set({ name })} placeholder="John Doe" id="create-name" maxLength={80} />
          </div>
          <div>
            <Field
              label="Email Address *"
              type="email"
              value={form.email}
              onChange={(email) => set({ email })}
              placeholder="john@example.com"
              id="create-email"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="mt-5">
          <Field
            label="Password *"
            type="password"
            value={form.password}
            onChange={(password) => set({ password })}
            placeholder={`Minimum ${MIN_PASSWORD} characters`}
            hint={`Must be at least ${MIN_PASSWORD} characters long`}
            id="create-password"
            autoComplete="new-password"
          />
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="create-role">User Role</Label>
            <Select id="create-role" value={form.role} onChange={(role) => set({ role })}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="create-status">Status</Label>
            <Select id="create-status" value={form.status} onChange={(status) => set({ status })}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </Select>
          </div>
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <Field
              label="Bonus minutes"
              type="number"
              min="0"
              value={form.bonusMinutes}
              onChange={(bonusMinutes) => set({ bonusMinutes })}
              hint="Extra minutes on top of the plan"
              id="create-bonus"
            />
          </div>
          <div>
            <Field
              label="Organization"
              value={form.organization}
              onChange={(organization) => set({ organization })}
              placeholder="Company Name"
              id="create-organization"
              maxLength={120}
            />
          </div>
        </div>

        <div className="mt-5">
          <Label htmlFor="create-plan" hint="Leave on the default to start them on the plan new sign-ups get.">
            Subscription Plan
          </Label>
          <Select id="create-plan" value={form.planId} onChange={(planId) => set({ planId })}>
            <option value="">Default plan for new sign-ups</option>
            {activePlans.map((plan) => (
              <option key={plan._id} value={plan._id}>
                {planLabel(plan)}
              </option>
            ))}
          </Select>
        </div>
      </form>
    </Modal>
  );
}
