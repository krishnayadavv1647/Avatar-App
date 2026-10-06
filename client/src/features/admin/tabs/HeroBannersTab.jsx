import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import BannerDialog from "../comms/BannerDialog";
import RowMenu from "../comms/RowMenu";
import { EmptyState, SearchBox, Skeletons, errorText } from "../comms/shared";
import Icon from "../icons";

/** The slides on the dashboard cover: their copy, media, call to action and order. */
export default function HeroBannersTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const { data: banners = [], isLoading } = useQuery({ queryKey: ["admin-banners"], queryFn: commsApi.banners });

  // The dashboard cover reads its own query; keep it in step with every change here.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
    queryClient.invalidateQueries({ queryKey: ["site-banners"] });
  };

  const toggle = useMutation({
    mutationFn: (b) => commsApi.updateBanner(b._id, { isActive: !b.isActive }),
    onSuccess: (_, b) => {
      toast.success(`Hero banner ${b.isActive ? "disabled" : "enabled"} successfully!`);
      refresh();
    },
    onError: (err) => toast.error(errorText(err, "Failed to update banner status.")),
  });

  const remove = useMutation({
    mutationFn: (b) => commsApi.deleteBanner(b._id),
    onSuccess: () => {
      toast.success("Hero banner deleted successfully!");
      refresh();
    },
    onError: (err) => toast.error(errorText(err, "Failed to delete hero banner.")),
    onSettled: () => setDeleting(null),
  });

  const open = (banner = null) => {
    setEditing(banner);
    setDialogOpen(true);
  };

  const q = search.toLowerCase();
  const shown = banners.filter((b) => b.title.toLowerCase().includes(q) || b.subtitle.toLowerCase().includes(q));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-h2">
          <Icon name="image" size={20} className="text-text-muted" />
          Hero Banner Management
        </h2>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
          <div className="min-w-[200px] max-w-xs flex-1">
            <SearchBox value={search} onChange={setSearch} placeholder="Search banners..." />
          </div>
          <Button onClick={() => open()}>+ New Banner</Button>
        </div>
      </div>

      {isLoading ? (
        <Skeletons count={3} className="h-36" />
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState icon="image">
            {search ? "No banners found matching your search." : "No hero banners created yet. Click 'New Banner' to get started."}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((b) => (
            <Card key={b._id} className={b.isActive ? "" : "opacity-60"}>
              <div className="flex items-start gap-3">
                {b.imageUrl && <img src={b.imageUrl} alt={b.title} className="h-16 w-20 shrink-0 rounded border border-border object-cover" />}
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-body font-semibold">{b.title}</h3>
                  <p className="mt-0.5 line-clamp-2 text-ui text-text-muted">{b.subtitle}</p>
                </div>
                <RowMenu
                  label={`Actions for ${b.title}`}
                  items={[
                    { label: "Edit", onSelect: () => open(b) },
                    { label: b.isActive ? "Disable" : "Enable", onSelect: () => toggle.mutate(b) },
                    { label: "Delete", danger: true, onSelect: () => setDeleting(b) },
                  ]}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone="neutral">Order: {b.displayOrder || 0}</Badge>
                <Badge tone="neutral">CTA: {b.ctaText || "Try Now"}</Badge>
                <Badge tone={b.isActive ? "green" : "red"}>{b.isActive ? "Active" : "Inactive"}</Badge>
              </div>
              <p className="mt-3 truncate text-label text-text-faint">Links to: {b.ctaLink || "Not set"}</p>
            </Card>
          ))}
        </div>
      )}

      <BannerDialog open={dialogOpen} banner={editing} onClose={() => setDialogOpen(false)} />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete hero banner"
        message="Are you sure you want to delete this hero banner? This cannot be undone."
        busy={remove.isPending}
        onConfirm={() => remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
