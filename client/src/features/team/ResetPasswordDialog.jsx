import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { teamApi } from "@/services/team.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import { toast } from "@/components/feedback/Toast";
import { CopyLine, MIN_PASSWORD, generatePassword } from "./password.jsx";

/**
 * Sets a new password for someone on the team. They are signed out everywhere,
 * so this is also how to lock out a lost device. Like adding a user, it ends
 * by showing the new password once, to be passed on.
 */
export default function ResetPasswordDialog({ member, onClose }) {
  const [password, setPassword] = useState(() => generatePassword());
  const [done, setDone] = useState(null);

  const reset = useMutation({
    mutationFn: () => teamApi.resetPassword(member.id, password),
    onSuccess: () => setDone(password),
    onError: (err) => toast.error(err.message),
  });

  const close = () => {
    if (reset.isPending) return;
    setDone(null);
    setPassword(generatePassword());
    onClose();
  };

  const who = member?.name || member?.email || "this person";

  if (done) {
    return (
      <Modal
        open={Boolean(member)}
        onClose={close}
        title="Password changed"
        description={`${who} is signed out everywhere. Send them the new password - it will not be shown again.`}
        footer={<Button onClick={close}>Done</Button>}
      >
        <CopyLine label="New password" value={done} />
      </Modal>
    );
  }

  return (
    <Modal
      open={Boolean(member)}
      onClose={close}
      title={`Reset password for ${who}`}
      description="They will be signed out on every device and need this password to get back in."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={reset.isPending}>
            Cancel
          </Button>
          <Button onClick={() => reset.mutate()} disabled={reset.isPending || password.length < MIN_PASSWORD}>
            {reset.isPending ? "Saving…" : "Reset password"}
          </Button>
        </>
      }
    >
      <Field
        label="New password"
        id="reset-password"
        value={password}
        onChange={setPassword}
        hint={`At least ${MIN_PASSWORD} characters.`}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setPassword(generatePassword())}
        className="mt-2 text-ui text-text-muted underline-offset-2 hover:text-text hover:underline"
      >
        Make another
      </button>
    </Modal>
  );
}
