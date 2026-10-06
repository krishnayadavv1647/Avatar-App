import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import { Checkbox, Label, Select } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import NotificationIcon, { NOTIFICATION_ICONS } from "@/features/site/NotificationIcon";
import { RichText, errorText, toLocalInput } from "./shared";

const EMPTY = {
  title: "",
  message: "",
  status: "draft",
  priority: "medium",
  displayType: "bell_only",
  targetRoles: ["user", "admin"],
  icon: "Bell",
  linkUrl: "",
  linkText: "",
  publishDate: "",
};

const HINTS = {
  popup_and_bell: "⚡ Users will see a popup dialog when they first login after this notification is published",
  bell_only: "📱 Users will only see this in the notification list",
};

const fromRecord = (n) => ({
  title: n.title || "",
  message: n.message || "",
  status: n.status || "draft",
  priority: n.priority || "medium",
  displayType: n.displayType || "bell_only",
  targetRoles: n.targetRoles || ["user", "admin"],
  icon: n.icon || "Bell",
  linkUrl: n.linkUrl || "",
  linkText: n.linkText || "",
  publishDate: toLocalInput(n.publishDate),
});

/** Create or edit a notification. `notification` is null when creating. */
export default function NotificationDialog({ open, notification, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // A fresh form each time the dialog opens, for a new record or an existing one.
  useEffect(() => {
    if (open) setForm(notification ? fromRecord(notification) : EMPTY);
  }, [open, notification]);

  const save = useMutation({
    mutationFn: () => {
      // The date is sent as the exact instant. An untouched date keeps the
      // stored value, so saving without editing it cannot shift it (the form
      // only holds it to the minute).
      const untouched = notification && form.publishDate === toLocalInput(notification.publishDate);
      const publishDate = untouched
        ? notification.publishDate
        : form.publishDate
          ? new Date(form.publishDate).toISOString()
          : notification
            ? null
            : undefined;

      const body = { ...form, ...(publishDate !== undefined && { publishDate }) };
      if (publishDate === undefined) delete body.publishDate;
      return notification ? commsApi.updateNotification(notification._id, body) : commsApi.createNotification(body);
    },
    onSuccess: () => {
      toast.success(notification ? "Notification updated successfully" : "Notification created successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
      onClose();
    },
    onError: (err) => toast.error(errorText(err, "Failed to save notification")),
  });

  const toggleRole = (role) =>
    set({ targetRoles: form.targetRoles.includes(role) ? form.targetRoles.filter((r) => r !== role) : [...form.targetRoles, role] });

  const submit = (e) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={save.isPending ? () => {} : onClose}
      title={notification ? "Edit Notification" : "Create New Notification"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="notification-form" disabled={save.isPending}>
            {save.isPending ? "Saving..." : notification ? "Update" : "Create"}
          </Button>
        </>
      }
    >
      <form id="notification-form" onSubmit={submit} className="space-y-5">
        <Field label="Title *" id="notif-title" value={form.title} onChange={(v) => set({ title: v })} placeholder="e.g., New Feature: AI Video Editor!" required />

        <div>
          <Label>Message *</Label>
          <RichText value={form.message} onChange={(message) => set({ message })} placeholder="Write your announcement message..." toolbar="basic" height={200} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="notif-status">Status</Label>
            <Select id="notif-status" value={form.status} onChange={(status) => set({ status })}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="notif-priority">Priority</Label>
            <Select id="notif-priority" value={form.priority} onChange={(priority) => set({ priority })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </div>
          <div>
            <Field label="Publish Date" id="notif-date" type="datetime-local" value={form.publishDate} onChange={(v) => set({ publishDate: v })} hint="Leave empty to publish when saved." />
          </div>
          <div>
            <Label htmlFor="notif-icon">Icon</Label>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-bg text-text-muted">
                <NotificationIcon name={form.icon} size={18} />
              </span>
              <Select id="notif-icon" value={form.icon} onChange={(icon) => set({ icon })}>
                {NOTIFICATION_ICONS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        <div>
          <Label htmlFor="notif-display">Display Type</Label>
          <Select id="notif-display" value={form.displayType} onChange={(displayType) => set({ displayType })}>
            <option value="bell_only">Bell Only - Show in notification list only</option>
            <option value="popup_and_bell">Popup + Bell - Show popup once, then in the list</option>
          </Select>
          <p className="mt-2 text-label text-text-faint">{HINTS[form.displayType]}</p>
        </div>

        <div>
          <Label>Target Roles</Label>
          <div className="flex gap-6">
            {["user", "admin"].map((role) => (
              <Checkbox key={role} checked={form.targetRoles.includes(role)} onChange={() => toggleRole(role)}>
                <span className="capitalize">{role}</span>
              </Checkbox>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Field label="Link URL (Optional)" id="notif-link" value={form.linkUrl} onChange={(v) => set({ linkUrl: v })} placeholder="https://example.com or /avatars" />
          </div>
          <div>
            <Field label="Link Text" id="notif-link-text" value={form.linkText} onChange={(v) => set({ linkText: v })} placeholder="e.g., Learn More" />
          </div>
        </div>
      </form>
    </Modal>
  );
}
