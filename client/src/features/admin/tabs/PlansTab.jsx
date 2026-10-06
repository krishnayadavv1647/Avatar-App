import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { adminApi } from "@/services/admin.api";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { toast } from "@/components/feedback/Toast";
import PlanCard from "../plans/PlanCard";
import PlanEditDialog from "../plans/PlanEditDialog";

// Must match server/src/modules/admin/plan.templates.js.
const TEMPLATE_KEYS = ["free", "starter", "pro", "business"];

const GRID = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };

/** Squares of 2, 3 and 4 columns, as the plan grid's density switch draws them. */
const DENSITY_PATHS = {
  2: "M2 2h5v12H2zM9 2h5v12H9z",
  3: "M1.5 2h3.5v12H1.5zM6.2 2h3.6v12H6.2zM11 2h3.5v12H11z",
  4: "M1 2h2.8v12H1zM4.6 2h2.8v12H4.6zM8.2 2h2.8v12H8.2zM11.8 2h3v12h-3z",
};

/**
 * Users & Access > Plans: create, edit and delete the plans users can be put
 * on. Limits are read live, so an edit reaches everyone on the plan with no
 * re-sync. A plan people are on cannot be deleted - deactivate it instead.
 */
export default function PlansTab() {
  const queryClient = useQueryClient();
  const [columns, setColumns] = useState(4);
  const [editing, setEditing] = useState(null); // null | "new" | plan
  const [deleting, setDeleting] = useState(null);

  const { data: plans = [], isLoading, error } = useQuery({ queryKey: ["admin-plans"], queryFn: adminApi.plans });

  const refresh = () => {
    for (const key of ["admin-plans", "admin-users", "admin-user"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const templates = useMutation({
    mutationFn: adminApi.addPlanTemplates,
    onSuccess: (result) => {
      toast.success(
        result.added.length
          ? `Added ${result.added.join(", ")}. None is the default for new sign-ups until you choose one.`
          : "The ready-made plans are already there.",
      );
      refresh();
    },
    onError: (err) => toast.error("Could not add the ready-made plans.", { description: err.message }),
  });
  const missingTemplates = TEMPLATE_KEYS.filter((k) => !plans.some((p) => p.key === k));

  // A plan people are on is refused up front with the count, rather than behind a confirm.
  const askDelete = (plan) => {
    if (plan.users > 0) {
      toast.error("Failed to delete plan.", {
        description: `${plan.users} user${plan.users === 1 ? " is" : "s are"} on this plan. Set it inactive instead, or move them to another plan first.`,
      });
      return;
    }
    setDeleting(plan);
  };

  const remove = useMutation({
    mutationFn: (plan) => adminApi.removePlan(plan._id),
    onSuccess: () => {
      toast.success("Plan deleted successfully!");
      refresh();
    },
    onError: (err) => toast.error("Failed to delete plan.", { description: err.message }),
    onSettled: () => setDeleting(null),
  });

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-h3">Plan Management</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-1" role="group" aria-label="Columns">
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n} columns`}
                  aria-pressed={columns === n}
                  onClick={() => setColumns(n)}
                  className={clsx(
                    "flex h-7 w-7 items-center justify-center rounded transition-colors",
                    columns === n ? "bg-surface-active text-text" : "text-text-muted hover:text-text",
                  )}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
                    <path d={DENSITY_PATHS[n]} />
                  </svg>
                </button>
              ))}
            </div>
            {plans.length > 0 && missingTemplates.length > 0 && (
              <Button variant="secondary" onClick={() => templates.mutate()} disabled={templates.isPending}>
                {templates.isPending ? "Adding…" : "Add ready-made plans"}
              </Button>
            )}
            <Button onClick={() => setEditing("new")}>Create Plan</Button>
          </div>
        </div>

        {error && <p className="mt-4 text-ui text-red">{error.message}</p>}
        {isLoading && <p className="mt-4 text-ui text-text-muted">Loading plans…</p>}

        <div className={clsx("mt-5 grid grid-cols-1 gap-5 md:grid-cols-2", GRID[columns])}>
          {plans.map((plan) => (
            <PlanCard key={plan._id} plan={plan} onEdit={() => setEditing(plan)} onDelete={() => askDelete(plan)} />
          ))}

          {plans.length === 0 && !isLoading && !error && (
            <div className="col-span-full py-8 text-center">
              <p className="text-text-muted">No plans created yet. Click "Create Plan" to get started.</p>
              <Button className="mt-4" variant="secondary" onClick={() => templates.mutate()} disabled={templates.isPending}>
                {templates.isPending ? "Adding…" : "Add ready-made plans"}
              </Button>
              <p className="mt-2 text-label text-text-faint">Free, Starter, Pro and Business - priced above what a call costs.</p>
            </div>
          )}
        </div>
      </Card>

      {editing && (
        <PlanEditDialog
          key={editing === "new" ? "new" : editing._id}
          plan={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name ?? "plan"}?`}
        message="Nobody is on this plan, so deleting it changes nothing for users. This cannot be undone."
        confirmLabel="Delete Plan"
        busyLabel="Deleting…"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
