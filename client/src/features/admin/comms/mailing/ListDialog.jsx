import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import { Label, SwitchRow, TextArea } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";

/**
 * Create or edit an email list. Whether it is a create or an edit is decided
 * only by whether a list was passed - not by a separate flag that could
 * disagree with it.
 */
export default function ListDialog({ open, list, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", description: "", isActive: true });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (open) setForm({ name: list?.name || "", description: list?.description || "", isActive: list?.isActive ?? true });
  }, [open, list]);

  const save = useMutation({
    mutationFn: () => (list ? commsApi.updateList(list._id, form) : commsApi.createList(form)),
    onSuccess: () => {
      toast.success(list ? "List updated successfully" : "List created successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-lists"] });
      queryClient.invalidateQueries({ queryKey: ["admin-mail-stats"] });
      onClose();
    },
    onError: (err) => toast.error(`Failed to save list: ${err.message}`),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Please enter a list name");
      return;
    }
    save.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={save.isPending ? () => {} : onClose}
      title={list ? "Edit List" : "Create New List"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="list-form" disabled={save.isPending}>
            {save.isPending ? "Saving..." : list ? "Save Changes" : "Create List"}
          </Button>
        </>
      }
    >
      <form id="list-form" onSubmit={submit} className="space-y-5">
        <Field label="List Name *" id="list-name" value={form.name} onChange={(v) => set({ name: v })} placeholder="e.g., Pro Plan Users" autoFocus />
        <div>
          <Label htmlFor="list-description">Description</Label>
          <TextArea id="list-description" value={form.description} onChange={(v) => set({ description: v })} rows={3} placeholder="Describe this email list..." />
        </div>
        <SwitchRow title="Active" description="Inactive lists cannot be used as an audience" checked={form.isActive} onChange={(isActive) => set({ isActive })} />
      </form>
    </Modal>
  );
}
