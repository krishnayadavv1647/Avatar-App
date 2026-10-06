import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import { Label, Select, SwitchRow, TextArea } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import MediaField from "./MediaField";
import { errorText } from "./shared";

/** The pages a card can point at - this app's real routes. */
export const TARGET_PAGES = ["Home", "Avatars", "Studio", "Conversations", "Usage", "AI tools", "Notifications"];

const EMPTY = {
  title: "",
  description: "",
  targetPage: "Home",
  targetLink: "",
  thumbnailUrl: "",
  displayOrder: 0,
  isActive: true,
  requiredFeature: "",
  isFeatureSection: false,
};

const fromRecord = (c) => ({
  title: c.title || "",
  description: c.description || "",
  targetPage: c.targetPage || "Home",
  targetLink: c.targetLink || "",
  thumbnailUrl: c.thumbnailUrl || "",
  displayOrder: c.displayOrder || 0,
  isActive: c.isActive ?? true,
  requiredFeature: c.requiredFeature || "",
  isFeatureSection: c.isFeatureSection || false,
});

/**
 * Create or edit a dashboard card. The icon, accent colour and "large"
 * settings have no controls (as in the product this follows): a new card gets
 * the model's defaults and an existing one keeps what it has, because only the
 * fields shown here are sent.
 */
export default function CardDialog({ open, card, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [uploading, setUploading] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (open) setForm(card ? fromRecord(card) : EMPTY);
  }, [open, card]);

  const save = useMutation({
    mutationFn: () => (card ? commsApi.updateCard(card._id, form) : commsApi.createCard(form)),
    onSuccess: () => {
      toast.success(card ? "Dashboard card updated successfully!" : "Dashboard card created successfully!");
      queryClient.invalidateQueries({ queryKey: ["admin-cards"] });
      onClose();
    },
    onError: (err) => toast.error(errorText(err, "Failed to save dashboard card. Please try again.")),
  });

  const submit = (e) => {
    e.preventDefault();
    save.mutate();
  };

  const busy = save.isPending || uploading;

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={card ? "Edit Dashboard Card" : "Create New Dashboard Card"}
      description="Configure the card that will appear in the dashboard sections."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="card-form" disabled={busy}>
            {save.isPending ? "Saving..." : uploading ? "Uploading..." : "Save Card"}
          </Button>
        </>
      }
    >
      <form id="card-form" onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Field label="Title" id="card-title" value={form.title} onChange={(v) => set({ title: v })} placeholder="e.g., Create an Avatar" required />
          </div>
          <div>
            <Label htmlFor="card-page">Target Page</Label>
            <Select id="card-page" value={form.targetPage} onChange={(targetPage) => set({ targetPage })}>
              {TARGET_PAGES.map((page) => (
                <option key={page} value={page}>
                  {page}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <Field label="Target Link (Optional)" id="card-link" value={form.targetLink} onChange={(v) => set({ targetLink: v })} placeholder="e.g., https://example.com/pricing" hint="If set, this will override the Target Page selection." />

        <div>
          <Label htmlFor="card-description">Description</Label>
          <TextArea id="card-description" value={form.description} onChange={(v) => set({ description: v })} rows={3} placeholder="Brief description of what this tool does..." required />
        </div>

        <MediaField folder="dashboard-cards" label="Thumbnail Image" value={form.thumbnailUrl} onChange={(v) => set({ thumbnailUrl: v })} onBusy={setUploading} removable />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Field label="Display Order" id="card-order" type="number" value={form.displayOrder} onChange={(v) => set({ displayOrder: parseInt(v, 10) || 0 })} placeholder="0" />
          </div>
          <div>
            <Field label="Required Feature (Optional)" id="card-feature" value={form.requiredFeature} onChange={(v) => set({ requiredFeature: v })} placeholder="e.g., ai_generator" />
          </div>
        </div>

        <div className="space-y-3">
          <SwitchRow title="Active" checked={form.isActive} onChange={(isActive) => set({ isActive })} />
          <SwitchRow
            title="Show in Features Section (instead of Create Your Way)"
            checked={form.isFeatureSection}
            onChange={(isFeatureSection) => set({ isFeatureSection })}
          />
        </div>
      </form>
    </Modal>
  );
}
