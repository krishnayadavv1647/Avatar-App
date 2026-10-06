import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { creditsAdminApi } from "@/services/admin.credits.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import Modal from "@/components/common/Modal";
import Field from "@/components/forms/Field";
import { Badge, SwitchRow } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { money } from "@/features/credits/useCredits";

/** The credit packs people can buy, as the admin makes them. */
export default function PacksCard() {
  const queryClient = useQueryClient();
  const { data: packs = [], isLoading, error } = useQuery({ queryKey: ["admin-credit-packs"], queryFn: creditsAdminApi.packs });
  const [editing, setEditing] = useState(null); // a pack, or {} for a new one
  const [removing, setRemoving] = useState(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-credit-packs"] });
    queryClient.invalidateQueries({ queryKey: ["credits"] });
  };

  const toggle = useMutation({
    mutationFn: ({ id, active }) => creditsAdminApi.updatePack(id, { active }),
    onSuccess: refresh,
    onError: (err) => toast.error(err.message),
  });
  const remove = useMutation({
    mutationFn: (id) => creditsAdminApi.removePack(id),
    onSuccess: () => {
      toast.success("Pack deleted");
      setRemoving(null);
      refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card
      title="Credit packs"
      action={<Button size="sm" onClick={() => setEditing({})}>New pack</Button>}
    >
      <p className="mt-2 text-ui text-text-muted">
        What people can buy with Stripe to top up. Active packs appear on their Credits page, once Stripe is set up.
      </p>

      {isLoading && <p className="mt-4 text-ui text-text-muted">Loading…</p>}
      {error && <p className="mt-4 text-ui text-red">{error.message}</p>}
      {!isLoading && packs.length === 0 && (
        <p className="mt-4 text-ui text-text-muted">No packs yet. Click "New pack" to make the first.</p>
      )}

      {packs.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-ui">
            <thead>
              <tr className="text-left text-text-faint">
                <th className="pb-2 font-normal">Pack</th>
                <th className="pb-2 text-right font-normal">Credits</th>
                <th className="pb-2 text-right font-normal">Price</th>
                <th className="pb-2 text-right font-normal">Per credit</th>
                <th className="pb-2 text-center font-normal">For sale</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {packs.map((pack) => (
                <tr key={pack._id} className="border-t border-border">
                  <td className="py-2.5">
                    <span className="font-medium">{pack.name}</span>
                    {pack.badge && <Badge tone="purple" className="ml-2">{pack.badge}</Badge>}
                    {pack.description && <p className="text-label text-text-faint">{pack.description}</p>}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{pack.credits.toLocaleString()}</td>
                  <td className="py-2.5 text-right tabular-nums">{money(pack.priceCents, pack.currency)}</td>
                  <td className="py-2.5 text-right tabular-nums text-text-muted">
                    {money(Math.round((pack.priceCents / pack.credits) * 1000) / 1000, pack.currency)}
                  </td>
                  <td className="py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={pack.active}
                      aria-label={`${pack.name} for sale`}
                      onChange={(e) => toggle.mutate({ id: pack._id, active: e.target.checked })}
                    />
                  </td>
                  <td className="py-2.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(pack)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(pack)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PackDialog
        pack={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Delete "${removing?.name}"?`}
        message="It stops being for sale. Credits people already bought with it stay on their accounts."
        busy={remove.isPending}
        onConfirm={() => remove.mutate(removing._id)}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}

const BLANK = { name: "", description: "", credits: "", price: "", badge: "", displayOrder: "0", active: true };

function PackDialog({ pack, onClose, onSaved }) {
  const [form, setForm] = useState(BLANK);
  const isNew = pack && !pack._id;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (!pack) return;
    setForm(
      pack._id
        ? {
            name: pack.name,
            description: pack.description || "",
            credits: String(pack.credits),
            price: String(pack.priceCents / 100),
            badge: pack.badge || "",
            displayOrder: String(pack.displayOrder ?? 0),
            active: pack.active,
          }
        : BLANK,
    );
  }, [pack]);

  const cents = Math.round(Number(form.price) * 100);
  const error =
    !form.name.trim()
      ? "Give the pack a name."
      : !(Number.isInteger(Number(form.credits)) && Number(form.credits) >= 1)
        ? "Credits must be a whole number."
        : !(cents >= 50)
          ? "The price must be at least $0.50, which is the least Stripe can charge."
          : null;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        credits: Number(form.credits),
        priceCents: cents,
        badge: form.badge.trim() || undefined,
        displayOrder: Number(form.displayOrder) || 0,
        active: form.active,
      };
      return isNew ? creditsAdminApi.createPack(body) : creditsAdminApi.updatePack(pack._id, body);
    },
    onSuccess: () => {
      toast.success(isNew ? "Pack created" : "Pack updated");
      onSaved();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Modal
      open={Boolean(pack)}
      onClose={save.isPending ? () => {} : onClose}
      title={isNew ? "New credit pack" : "Edit credit pack"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={Boolean(error) || save.isPending}>
            {save.isPending ? "Saving…" : isNew ? "Create pack" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Name" id="pack-name" value={form.name} onChange={(name) => set({ name })} placeholder="Starter pack" maxLength={60} />
        </div>
        <Field label="Credits" id="pack-credits" type="number" min="1" step="1" value={form.credits} onChange={(credits) => set({ credits })} />
        <Field label="Price (USD)" id="pack-price" type="number" min="0.5" step="0.01" value={form.price} onChange={(price) => set({ price })} />
        <Field label="Badge (optional)" id="pack-badge" value={form.badge} onChange={(badge) => set({ badge })} placeholder="Most popular" maxLength={24} />
        <Field label="Display order" id="pack-order" type="number" min="0" step="1" value={form.displayOrder} onChange={(displayOrder) => set({ displayOrder })} hint="Lower comes first." />
        <div className="sm:col-span-2">
          <Field label="Description (optional)" id="pack-desc" value={form.description} onChange={(description) => set({ description })} maxLength={200} />
        </div>
        <div className="sm:col-span-2">
          <SwitchRow title="For sale" description="Shown on people's Credits page." checked={form.active} onChange={(active) => set({ active })} />
        </div>
        {error && <p className="text-ui text-red sm:col-span-2">{error}</p>}
      </div>
    </Modal>
  );
}
