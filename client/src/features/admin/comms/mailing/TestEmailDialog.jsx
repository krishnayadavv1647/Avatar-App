import { useEffect, useState } from "react";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";

/** Asks for an address and hands it to `onSend`. The caller does the sending, so it can word its own toasts. */
export default function TestEmailDialog({ open, title = "Send Test Email", description, busy, initialEmail = "", onSend, onClose }) {
  const [email, setEmail] = useState(initialEmail);

  useEffect(() => {
    if (open) setEmail(initialEmail);
  }, [open, initialEmail]);

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="test-email-form" disabled={busy}>
            {busy ? "Sending..." : "Send Test"}
          </Button>
        </>
      }
    >
      <form
        id="test-email-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSend(email.trim());
        }}
      >
        <Field label="Test Recipient Email" id="test-email" type="email" value={email} onChange={setEmail} placeholder="test@example.com" autoFocus />
      </form>
    </Modal>
  );
}
