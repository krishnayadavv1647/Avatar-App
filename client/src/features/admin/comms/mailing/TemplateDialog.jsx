import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import Segmented from "@/components/forms/Segmented";
import { Label, Select, Switch, TextArea } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { useBranding } from "@/hooks/useBranding";
import { EmailPreview, RichText, errorText } from "../shared";

/** Every placeholder an email can use; the server fills the same names in every kind of send. */
export const PLACEHOLDER_LIST = [
  "userName",
  "userEmail",
  "planName",
  "minutes",
  "loginUrl",
  "supportEmail",
  "appName",
  "inviteLink",
  "inviterName",
  "resetLink",
];
const DEFAULT_GUIDE = "{{userName}}, {{userEmail}}, {{planName}}, {{minutes}}, {{loginUrl}}";

export const TEMPLATE_TYPES = [
  ["none", "None (Custom)"],
  ["welcome_email", "Welcome Email"],
  ["invitation_email", "Invitation Email"],
  ["forgot_password", "Forgot Password"],
  ["plan_activated", "Plan Activated"],
  ["plan_updated", "Plan Updated"],
  ["plan_deactivated_refund", "Plan Deactivated (Refund)"],
  ["subscription_cancelled", "Subscription Cancelled"],
  ["training_webinar", "Training Webinar"],
];

const blank = (fromName) => ({
  templateType: "none",
  name: "",
  subject: "",
  fromName,
  htmlBody: "",
  textBody: "",
  isActive: true,
  isSystemTemplate: false,
  placeholdersGuide: DEFAULT_GUIDE,
});

const fromRecord = (t, fromName) => ({
  templateType: t.templateType || "none",
  name: t.name || "",
  subject: t.subject || "",
  fromName: t.fromName || fromName,
  htmlBody: t.htmlBody || "",
  textBody: t.textBody || "",
  isActive: t.isActive ?? true,
  isSystemTemplate: t.isSystemTemplate ?? false,
  placeholdersGuide: t.placeholdersGuide || DEFAULT_GUIDE,
});

const TABS = [
  { value: "design", label: "Design" },
  { value: "content", label: "Content" },
  { value: "preview", label: "Preview" },
];

/** Create or edit an email template. `template` is null when creating. */
export default function TemplateDialog({ open, template, onClose }) {
  const queryClient = useQueryClient();
  const brand = useBranding();
  const [form, setForm] = useState(() => blank(brand.name));
  const [tab, setTab] = useState("design");
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (open) {
      setForm(template ? fromRecord(template, brand.name) : blank(brand.name));
      setTab("design");
    }
  }, [open, template, brand.name]);

  const save = useMutation({
    mutationFn: () => (template ? commsApi.updateTemplate(template._id, form) : commsApi.createTemplate(form)),
    onSuccess: () => {
      toast.success(template ? "Email template updated successfully!" : "Email template created successfully!");
      queryClient.invalidateQueries({ queryKey: ["admin-templates"] });
      queryClient.invalidateQueries({ queryKey: ["admin-mail-stats"] });
      onClose();
    },
    onError: (err) => toast.error(errorText(err, "Failed to save template. Please try again.")),
  });

  const submit = () => {
    if (!form.name.trim() || !form.subject.trim() || !form.htmlBody.replace(/<[^>]*>/g, "").trim()) {
      toast.error("Please fill in all required fields (Name, Subject, HTML Body)");
      return;
    }
    save.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={save.isPending ? () => {} : onClose}
      title={template ? "Edit Email Template" : "Create Email Template"}
      description="Create and customize email templates for different system events."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "Saving..." : template ? "Update Template" : "Create Template"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Segmented value={tab} onChange={setTab} options={TABS} />

        {tab === "design" && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="tpl-type" hint='Select "None" for custom templates that won&apos;t be used by automated systems'>
                  Template Type *
                </Label>
                <Select id="tpl-type" value={form.templateType} onChange={(templateType) => set({ templateType })}>
                  {TEMPLATE_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Field label="Template Name *" id="tpl-name" value={form.name} onChange={(v) => set({ name: v })} placeholder="e.g., Product Update #1" />
              </div>
            </div>

            <div>
              <Field label="From Name" id="tpl-from" value={form.fromName} onChange={(v) => set({ fromName: v })} placeholder={brand.name} />
            </div>

            <div className="flex items-start justify-between gap-6 rounded-lg border border-yellow bg-bg p-4">
              <div>
                <p className="text-body font-semibold">System Template</p>
                <p className="mt-1 text-ui text-text-muted">
                  Enable this ONLY if you want this template to be used by automated system events (welcome emails, password resets, etc.).
                </p>
                <p className="mt-1 text-ui font-semibold text-yellow">Leave OFF for custom templates that should only be sent manually.</p>
              </div>
              <Switch checked={form.isSystemTemplate} onChange={(isSystemTemplate) => set({ isSystemTemplate })} label="System Template" />
            </div>

            <div>
              <Field label="Email Subject *" id="tpl-subject" value={form.subject} onChange={(v) => set({ subject: v })} placeholder={`e.g., Welcome to ${brand.name}!`} />
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={form.isActive} onChange={(isActive) => set({ isActive })} label="Active Template" />
              <span className="text-ui">Active Template</span>
            </div>

            <div className="rounded-lg border border-border bg-bg p-4">
              <h4 className="mb-2 text-ui font-semibold">📝 Available placeholders:</h4>
              <p className="break-words font-mono text-label text-text-muted">{PLACEHOLDER_LIST.map((p) => `{{${p}}}`).join(", ")}</p>
              <p className="mt-2 text-label text-text-faint">Use double curly braces around placeholder names. They are filled in for each recipient when the email is sent.</p>
            </div>
          </div>
        )}

        {tab === "content" && (
          <div className="space-y-5">
            <div>
              <Label>HTML Email Body *</Label>
              <RichText value={form.htmlBody} onChange={(htmlBody) => set({ htmlBody })} height={320} />
            </div>
            <div>
              <Label htmlFor="tpl-text">Plain Text Version (Optional)</Label>
              <TextArea id="tpl-text" value={form.textBody} onChange={(textBody) => set({ textBody })} rows={6} placeholder="Plain text version of your email..." />
            </div>
          </div>
        )}

        {tab === "preview" && (
          <div className="space-y-3">
            <div className="rounded border border-border bg-bg p-3 text-ui text-text-muted">
              <p>
                <strong className="text-text">From:</strong> {form.fromName || brand.name}
              </p>
              <p>
                <strong className="text-text">Subject:</strong> {form.subject}
              </p>
            </div>
            <EmailPreview html={form.htmlBody} />
            <p className="text-label text-text-faint">Placeholders are filled in when the email is sent; use the Test button on the template to see them filled.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
