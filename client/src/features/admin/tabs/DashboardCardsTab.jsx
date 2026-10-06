import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import CardDialog from "../comms/CardDialog";
import RowMenu from "../comms/RowMenu";
import { EmptyState, SearchBox, Skeletons, errorText } from "../comms/shared";
import Icon from "../icons";

/**
 * Dashboard feature cards. Like the product this follows, the cards are
 * managed here but nothing shows them to end users yet.
 */
export default function DashboardCardsTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const { data: cards = [], isLoading } = useQuery({ queryKey: ["admin-cards"], queryFn: commsApi.cards });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-cards"] });

  const toggle = useMutation({
    mutationFn: (c) => commsApi.updateCard(c._id, { isActive: !c.isActive }),
    onSuccess: (_, c) => {
      toast.success(`Dashboard card ${c.isActive ? "disabled" : "enabled"} successfully!`);
      refresh();
    },
    onError: (err) => toast.error(errorText(err, "Failed to update card status.")),
  });

  const remove = useMutation({
    mutationFn: (c) => commsApi.deleteCard(c._id),
    onSuccess: () => {
      toast.success("Dashboard card deleted successfully!");
      refresh();
    },
    onError: (err) => toast.error(errorText(err, "Failed to delete dashboard card.")),
    onSettled: () => setDeleting(null),
  });

  const open = (card = null) => {
    setEditing(card);
    setDialogOpen(true);
  };

  const q = search.toLowerCase();
  const shown = cards.filter((c) =>
    [c.title, c.description, c.targetPage, c.targetLink].some((field) => (field || "").toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-h2">
          <Icon name="layers" size={20} className="text-text-muted" />
          Dashboard Cards Management
        </h2>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
          <div className="min-w-[200px] max-w-xs flex-1">
            <SearchBox value={search} onChange={setSearch} placeholder="Search cards..." />
          </div>
          <Button onClick={() => open()}>+ New Card</Button>
        </div>
      </div>

      {isLoading ? (
        <Skeletons count={3} className="h-36" />
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState icon="layers">
            {search ? "No cards found matching your search." : "No dashboard cards created yet. Click 'New Card' to get started."}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => (
            <Card key={c._id} className={`h-full ${c.isActive ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-text-muted">
                  {c.thumbnailUrl ? <img src={c.thumbnailUrl} alt={c.title} className="h-full w-full object-cover" /> : <Icon name="layers" size={20} />}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-body font-semibold">{c.title}</h3>
                  <span className="block truncate text-label text-text-faint">{c.targetLink || c.targetPage}</span>
                </div>
                <RowMenu
                  label={`Actions for ${c.title}`}
                  items={[
                    { label: "Edit", onSelect: () => open(c) },
                    { label: c.isActive ? "Disable" : "Enable", onSelect: () => toggle.mutate(c) },
                    { label: "Delete", danger: true, onSelect: () => setDeleting(c) },
                  ]}
                />
              </div>
              <p className="mt-3 line-clamp-3 text-ui text-text-muted">{c.description}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone="neutral">Order: {c.displayOrder || 0}</Badge>
                {c.isFeatureSection && <Badge tone="purple">Features Section</Badge>}
                {c.requiredFeature && <Badge tone="outline">Requires: {c.requiredFeature}</Badge>}
                <Badge tone={c.isActive ? "green" : "red"}>{c.isActive ? "Active" : "Inactive"}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CardDialog open={dialogOpen} card={editing} onClose={() => setDialogOpen(false)} />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete dashboard card"
        message="Are you sure you want to delete this dashboard card? This cannot be undone."
        busy={remove.isPending}
        onConfirm={() => remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
