import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import { Label, TextArea } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";

/** A new outbound email from the support address. Plain text in; the server builds the HTML. */
export default function SupportComposeDialog({ open, onClose, onSent, defaultTo = "", defaultSubject = "", from }) {
  const [form, setForm] = useState({ to: defaultTo, subject: defaultSubject, body: "" });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (open) setForm({ to: defaultTo, subject: defaultSubject, body: "" });
  }, [open, defaultTo, defaultSubject]);

  const send = useMutation({
    mutationFn: () => commsApi.composeSupport({ to: form.to.trim(), subject: form.subject.trim(), body: form.body }),
    onSuccess: () => {
      toast.success("Email sent");
      onClose();
      onSent?.();
    },
    onError: (err) => toast.error(`Failed to send: ${err.message}`),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.to.trim() || !form.subject.trim() || !form.body.trim()) {
      toast.error("Please fill in To, Subject, and Message");
      return;
    }
    send.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={send.isPending ? () => {} : onClose}
      title="New Email"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="support-compose-form" disabled={send.isPending}>
            {send.isPending ? "Sending..." : "Send Email"}
          </Button>
        </>
      }
    >
      <form id="support-compose-form" onSubmit={submit} className="space-y-4">
        <Field label="To" id="compose-to" type="email" value={form.to} onChange={(to) => set({ to })} placeholder="recipient@example.com" disabled={send.isPending} />
        <Field label="Subject" id="compose-subject" value={form.subject} onChange={(subject) => set({ subject })} placeholder="Email subject" disabled={send.isPending} />
        <div>
          <Label htmlFor="compose-body">Message</Label>
          <TextArea id="compose-body" value={form.body} onChange={(body) => set({ body })} rows={10} placeholder="Write your message..." disabled={send.isPending} className="resize-none" />
        </div>
        {from && (
          <p className="text-label text-text-faint">
            Sent from <span className="text-pink">{from}</span>
          </p>
        )}
      </form>
    </Modal>
  );
}
