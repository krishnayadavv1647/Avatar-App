import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/services/admin.api";
import { adminUsersApi } from "@/services/admin.users.api";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import { Label, Select, TextArea } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import InvitationCreated from "../invite/InvitationCreated";
import RecentInvitations from "../invite/RecentInvitations";
import { planLabel } from "../users/userUi";

const EMPTY = { email: "", role: "user", planId: "", message: "" };

/**
 * Users & Access > Invite User: invite an email address onto a plan. The
 * person gets a link; opening it, signing in with that address and accepting
 * puts them on the plan. The link is good for seven days.
 */
export default function InviteTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [created, setCreated] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const { data: plans = [], isLoading: plansLoading } = useQuery({ queryKey: ["admin-plans"], queryFn: adminApi.plans });
  const activePlans = plans.filter((p) => p.active);

  const invite = useMutation({
    mutationFn: () =>
      adminUsersApi.createInvitation({
        email: form.email.trim(),
        role: form.role,
        planId: form.planId,
        ...(form.message.trim() && { message: form.message.trim() }),
      }),
    onSuccess: (result) => {
      if (result.emailSent) {
        toast.success(`Invitation sent to ${result.invitation.email}!`);
      } else {
        toast.error("Email Sending Failed", {
          description: `${result.emailError} Please share the link manually.`,
          duration: 8000,
        });
      }
      setCreated(result);
      setForm(EMPTY);
      queryClient.invalidateQueries({ queryKey: ["admin-invitations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    },
    onError: (error) => toast.error("Error creating invitation. Please try again.", { description: error.message }),
  });

  if (created) return <InvitationCreated result={created} onAnother={() => setCreated(null)} />;

  const ready = form.email.trim() && form.planId && !invite.isPending;

  const submit = (e) => {
    e.preventDefault();
    if (!form.email.trim() || !form.planId) {
      toast.error("Email and a plan are required.");
      return;
    }
    invite.mutate();
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <h2 className="text-h3">Create User Invitation</h2>

        <form onSubmit={submit} className="mt-5 space-y-6" noValidate>
          <Field
            label="Email Address"
            id="invite-email"
            type="email"
            value={form.email}
            onChange={(email) => set({ email })}
            placeholder="name@example.com"
            autoComplete="off"
          />

          <div>
            <Label htmlFor="invite-role">User Role</Label>
            <Select id="invite-role" value={form.role} onChange={(role) => set({ role })}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </Select>
          </div>

          <div>
            <Label htmlFor="invite-plan">Subscription Plan</Label>
            <Select id="invite-plan" value={form.planId} onChange={(planId) => set({ planId })} disabled={activePlans.length === 0}>
              <option value="">Choose a plan…</option>
              {activePlans.map((plan) => (
                <option key={plan._id} value={plan._id}>
                  {planLabel(plan)}
                </option>
              ))}
            </Select>
            {!plansLoading && activePlans.length === 0 ? (
              <p className="mt-2 text-ui text-text-muted">
                There are no active plans to invite onto.{" "}
                <Link to="/admin?tab=plans" className="text-pink hover:underline">
                  Create a plan
                </Link>
              </p>
            ) : (
              !form.planId && <p className="mt-2 text-ui text-red">Please select a plan.</p>
            )}
          </div>

          <div>
            <Label htmlFor="invite-message">Welcome Message (Optional)</Label>
            <TextArea id="invite-message" rows={3} maxLength={500} value={form.message} onChange={(message) => set({ message })} />
          </div>

          <Button type="submit" fullWidth disabled={!ready}>
            {invite.isPending ? "Creating..." : "Create & Send"}
          </Button>
        </form>
      </Card>

      <RecentInvitations />
    </div>
  );
}
