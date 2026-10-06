import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import { Label, Select, TextArea } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { useBranding } from "@/hooks/useBranding";
import AudienceFields, { DEFAULT_AUDIENCE } from "./AudienceFields";

/** Schedule an email for later, to everyone or to a segment. */
export default function ScheduleDialog({ open, onClose }) {
  const queryClient = useQueryClient();
  const brand = useBranding();
  const blank = () => ({ title: "", subject: "", fromName: brand.name, htmlBody: "", scheduledDate: "", audience: DEFAULT_AUDIENCE });
  const [form, setForm] = useState(blank);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const { data: templates = [] } = useQuery({ queryKey: ["admin-templates"], queryFn: commsApi.templates, enabled: open });

  useEffect(() => {
    if (open) setForm(blank());
    // blank() closes over the brand name, which only matters at the moment of opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const useTemplate = (id) => {
    const t = templates.find((x) => x._id === id);
    if (!t) return;
    // Keeps what the admin already typed as a subject or sender, and fills the gaps.
    setForm((f) => ({ ...f, subject: f.subject || t.subject, htmlBody: t.htmlBody, ...(!f.title && { title: t.name }) }));
    toast.success("Template loaded successfully!");
  };

  const save = useMutation({
    mutationFn: () =>
      commsApi.schedule({
        title: form.title,
        subject: form.subject,
        fromName: form.fromName,
        htmlBody: form.htmlBody,
        scheduledDate: new Date(form.scheduledDate).toISOString(),
        audience: form.audience,
      }),
    onSuccess: () => {
      toast.success("Email scheduled successfully!");
      queryClient.invalidateQueries({ queryKey: ["admin-scheduled"] });
      queryClient.invalidateQueries({ queryKey: ["admin-mail-stats"] });
      onClose();
    },
    onError: (err) => toast.error(err.message || "Failed to schedule email."),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.subject.trim() || !form.fromName.trim() || !form.htmlBody.trim() || !form.scheduledDate) {
      toast.error("Please fill in all required fields.");
      return;
    }
    save.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={save.isPending ? () => {} : onClose}
      title="Schedule New Email"
      description="Configure the details for your new scheduled email."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="schedule-form" disabled={save.isPending}>
            {save.isPending ? "Scheduling..." : "Schedule Email"}
          </Button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={submit} className="space-y-5">
        <Field label="Email Title" id="sch-title" value={form.title} onChange={(v) => set({ title: v })} placeholder="e.g., Welcome Email, New Feature Announcement" />
        <Field label="Subject Line" id="sch-subject" value={form.subject} onChange={(v) => set({ subject: v })} placeholder={`Exciting update from ${brand.name}!`} />
        <Field label="Sender Name" id="sch-from" value={form.fromName} onChange={(v) => set({ fromName: v })} placeholder={`${brand.name} Team`} />
        <Field label="Scheduled Date & Time" id="sch-date" type="datetime-local" value={form.scheduledDate} onChange={(v) => set({ scheduledDate: v })} hint="In your local time. A time in the past sends within a minute." />

        <AudienceFields simple value={form.audience} onChange={(audience) => set({ audience })} />

        <div>
          <Label htmlFor="sch-template">Use template</Label>
          <Select id="sch-template" value="" onChange={useTemplate}>
            <option value="">Load the content of a template…</option>
            {templates.map((t) => (
              <option key={t._id} value={t._id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="sch-html" hint="Placeholders such as {{userName}} and {{planName}} are filled in for each recipient.">
            Email Content (HTML)
          </Label>
          <TextArea id="sch-html" mono value={form.htmlBody} onChange={(htmlBody) => set({ htmlBody })} rows={10} />
        </div>
      </form>
    </Modal>
  );
}
