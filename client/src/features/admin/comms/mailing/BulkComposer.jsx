import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import Field from "@/components/forms/Field";
import Segmented from "@/components/forms/Segmented";
import { Label, Select, TextArea } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { useBranding } from "@/hooks/useBranding";
import { EmailPreview, RichText } from "../shared";
import AudienceFields, { DEFAULT_AUDIENCE } from "./AudienceFields";
import TestEmailDialog from "./TestEmailDialog";

const EMPTY = { subject: "", htmlBody: "", textBody: "", fromName: "", templateId: "" };

const people = (n) => `${n} Recipient${n === 1 ? "" : "s"}`;

/**
 * The Bulk Email inner tab: compose, choose an audience, preview, send.
 *
 * The audience is sent as criteria and resolved by the server. The count shown
 * here is the server's count of the same criteria, so what the button says is
 * what will go out.
 */
export default function BulkComposer({ onSent }) {
  const brand = useBranding();
  const [tab, setTab] = useState("compose");
  const [form, setForm] = useState(EMPTY);
  const [audience, setAudience] = useState(DEFAULT_AUDIENCE);
  const [confirming, setConfirming] = useState(false);
  const [testing, setTesting] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const { data: templates = [] } = useQuery({ queryKey: ["admin-templates"], queryFn: commsApi.templates });
  const { data: count = 0 } = useQuery({
    queryKey: ["admin-audience-count", audience],
    queryFn: () => commsApi.audienceCount(audience),
    placeholderData: (previous) => previous,
  });

  const loadTemplate = (id) => {
    const t = templates.find((x) => x._id === id);
    if (!t) return;
    setForm({ subject: t.subject, htmlBody: t.htmlBody, textBody: t.textBody || "", fromName: t.fromName || "", templateId: id });
    toast.success("Template loaded successfully!");
  };

  const payload = () => ({
    subject: form.subject,
    html: form.htmlBody,
    ...(form.textBody && { text: form.textBody }),
    ...(form.fromName && { fromName: form.fromName }),
  });

  const sendTest = useMutation({
    mutationFn: (to) => commsApi.sendTest({ to, ...payload() }),
    onSuccess: (_, to) => {
      toast.success(`Test email sent to ${to}!`);
      setTesting(false);
    },
    onError: (err) => toast.error(err.status === 503 ? err.message : `Failed to send test email: ${err.message}`),
  });

  const send = useMutation({
    mutationFn: () => commsApi.sendBulk({ audience, ...payload() }),
    onSuccess: ({ total, sent, failed, errors }) => {
      if (failed === 0) {
        toast.success(`Email sent to ${sent} recipient${sent === 1 ? "" : "s"}!`);
      } else {
        // Say exactly what happened: some went out, some did not, and to whom.
        toast.error(`Sent to ${sent} of ${total} recipients; ${failed} failed`, {
          description: errors
            .slice(0, 5)
            .map((e) => `${e.email}: ${e.error}`)
            .join("\n"),
        });
      }
      if (sent > 0) {
        setForm(EMPTY);
        onSent?.();
      }
    },
    onError: (err) => toast.error(err.status === 503 ? err.message : `Failed to send bulk email: ${err.message}`),
    onSettled: () => setConfirming(false),
  });

  const requestSend = () => {
    if (!form.subject.trim() || !form.htmlBody.replace(/<[^>]*>/g, "").trim()) return toast.error("Please fill in subject and message");
    if (count === 0) return toast.error("No recipients selected");
    setConfirming(true);
  };

  const requestTest = () => {
    if (!form.subject.trim() || !form.htmlBody.replace(/<[^>]*>/g, "").trim()) return toast.error("Please write a subject and message first");
    setTesting(true);
  };

  return (
    <div className="space-y-5">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "compose", label: "Compose" },
          { value: "audience", label: `Audience (${count})` },
          { value: "preview", label: "Preview" },
        ]}
      />

      {tab === "compose" && (
        <Card className="space-y-5 p-6">
          <div>
            <Label htmlFor="bulk-template">Load from Template (Optional)</Label>
            <Select id="bulk-template" value={form.templateId} onChange={loadTemplate}>
              <option value="">Select a template...</option>
              {templates.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <Field label="From Name" id="bulk-from" value={form.fromName} onChange={(v) => set({ fromName: v })} placeholder={brand.name} />
          <Field label="Subject Line" id="bulk-subject" value={form.subject} onChange={(v) => set({ subject: v })} placeholder="Enter email subject..." />
          <div>
            <Label hint="Placeholders such as {{userName}} and {{planName}} are filled in for each recipient.">Email Message (HTML)</Label>
            <RichText value={form.htmlBody} onChange={(htmlBody) => set({ htmlBody })} height={260} />
          </div>
          <div>
            <Label htmlFor="bulk-text">Plain Text Version (Optional)</Label>
            <TextArea id="bulk-text" value={form.textBody} onChange={(textBody) => set({ textBody })} rows={4} placeholder="Auto-generated from HTML if left empty..." />
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button variant="secondary" onClick={requestTest}>
              Send Test Email
            </Button>
            <Button className="flex-1" onClick={requestSend} disabled={send.isPending || count === 0}>
              {send.isPending ? "Sending..." : `Send to ${people(count)}`}
            </Button>
          </div>
        </Card>
      )}

      {tab === "audience" && (
        <Card className="space-y-5 p-6">
          <AudienceFields value={audience} onChange={setAudience} />
          <div className="rounded-lg border border-border bg-bg p-4">
            <p className="text-body font-semibold">{people(count)} Selected</p>
          </div>
        </Card>
      )}

      {tab === "preview" && (
        <Card className="space-y-4 p-6">
          <div>
            <p className="text-label text-text-muted">From:</p>
            <p className="font-medium">{form.fromName || brand.name}</p>
          </div>
          <div>
            <p className="text-label text-text-muted">Subject:</p>
            <p className="font-medium">{form.subject || "(No subject)"}</p>
          </div>
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-label text-text-muted">Message Preview:</p>
            <EmailPreview html={form.htmlBody} />
          </div>
        </Card>
      )}

      <TestEmailDialog
        open={testing}
        description="Send a test version of this email to verify formatting and content"
        busy={sendTest.isPending}
        onClose={() => setTesting(false)}
        onSend={(to) => (to ? sendTest.mutate(to) : toast.error("Please enter a test email address"))}
      />

      <ConfirmDialog
        open={confirming}
        title="Send email"
        message={`Send this email to ${count} recipient(s)?`}
        confirmLabel="Send"
        busyLabel="Sending..."
        danger={false}
        busy={send.isPending}
        onConfirm={() => send.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
