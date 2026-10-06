import Modal from "./Modal";
import Button from "./Button";

/**
 * "Are you sure?" for destructive actions, in place of the browser's confirm().
 *
 * Controlled: render it with `open` true while the question is showing.
 * `busy` disables both buttons while the action runs; the caller closes it.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  busyLabel,
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onCancel}
      title={title}
      description={message}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? busyLabel || `${confirmLabel}…` : confirmLabel}
          </Button>
        </div>
      }
    />
  );
}
