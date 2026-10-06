import ConfirmDialog from "@/components/common/ConfirmDialog";

/**
 * The question before acting as someone: what it means, said plainly. Used by
 * the Users list, a user's detail page and the Avatars tab.
 *
 * `act` is the object returned by useActAsUser().
 */
export default function ActAsUserDialog({ act }) {
  const user = act.target;

  return (
    <ConfirmDialog
      open={Boolean(user)}
      title={`Act as ${user?.name || user?.email || "this user"}?`}
      message={
        "You will see the app exactly as they do, and anything you change is real. " +
        "Every change is recorded against your admin account. It ends after an hour, or when you exit."
      }
      confirmLabel="Act as user"
      busyLabel="Signing in…"
      danger={false}
      busy={act.start.isPending}
      onConfirm={() => act.start.mutate(user.id)}
      onCancel={act.close}
    />
  );
}
