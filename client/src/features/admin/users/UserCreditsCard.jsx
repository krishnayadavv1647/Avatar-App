import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminUsersApi } from "@/services/admin.users.api";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import Segmented from "@/components/forms/Segmented";
import { Label } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { INPUT_CLASS } from "./userUi";

/**
 * A user's credits inside Edit User: the balance, and a small form to add or
 * remove some with a reason. It acts on its own button, straight away - it is
 * not part of the dialog's Save, because a change to someone's balance should
 * not wait on, or be undone by, an unrelated edit. The server keeps the reason
 * on the ledger and in the audit log.
 *
 * Not a <form>: it sits inside one, so Enter is handled here instead.
 */
export default function UserCreditsCard({ userId }) {
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState("add");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const { data, error, isLoading } = useQuery({
    queryKey: ["admin-user-credits", userId],
    queryFn: () => adminUsersApi.credits(userId),
  });

  const change = useMutation({
    mutationFn: (credits) => adminUsersApi.adjustCredits(userId, { credits, note: note.trim() }),
    onSuccess: (_result, credits) => {
      toast.success(credits > 0 ? `Added ${credits.toLocaleString()} credits.` : `Removed ${Math.abs(credits).toLocaleString()} credits.`);
      setAmount("");
      setNote("");
      for (const key of ["admin-user-credits", "admin-users", "admin-user"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => toast.error("Could not change credits.", { description: err.message }),
  });

  const apply = () => {
    const credits = Number(amount);
    if (!Number.isInteger(credits) || credits <= 0) return toast.error("Enter a whole number of credits.");
    if (note.trim().length < 3) return toast.error("Say why, in a few words.");
    change.mutate(direction === "add" ? credits : -credits);
  };

  const onEnter = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!change.isPending) apply();
  };

  return (
    <Card title="Credits" className="bg-surface-2">
      <div className="mt-3 flex items-baseline gap-2">
        {isLoading && <span className="text-ui text-text-muted">Loading…</span>}
        {error && <span className="text-ui text-red">{error.message}</span>}
        {data && (
          <>
            <span className="text-h2 font-semibold">{data.balance.toLocaleString()}</span>
            <span className="text-ui text-text-muted">credits</span>
          </>
        )}
      </div>
      {data?.unlimited && (
        <p className="mt-1 text-label text-text-faint">Their plan has unlimited credits, so calls never use this balance.</p>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <p className="text-ui font-medium">Add or remove credits</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Segmented
            value={direction}
            onChange={setDirection}
            options={[
              { value: "add", label: "+ Add" },
              { value: "remove", label: "− Remove" },
            ]}
          />
          <div className="w-32">
            <Label htmlFor="credits-amount">Credits</Label>
            <input
              id="credits-amount"
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={onEnter}
              placeholder="e.g. 100"
              className={INPUT_CLASS}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <Label htmlFor="credits-note">Reason (required)</Label>
            <input
              id="credits-note"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={onEnter}
              placeholder="Goodwill after an outage"
              className={INPUT_CLASS}
            />
          </div>
          <Button type="button" variant="secondary" onClick={apply} disabled={change.isPending}>
            {change.isPending ? "Applying…" : direction === "add" ? "Add credits" : "Remove credits"}
          </Button>
        </div>
        <p className="mt-2 text-label text-text-faint">Applied at once and recorded with your reason - separate from Update User.</p>
      </div>
    </Card>
  );
}
