import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import Icon from "../../icons";
import { EmptyState, SearchBox, Skeletons } from "../shared";
import ListDialog from "./ListDialog";
import MembersDialog from "./MembersDialog";

/** A CSV the browser saves, from the text the server built. */
function download({ filename, csv }) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** The Email Lists inner tab: lists as cards with their live member counts. */
export default function ListsPanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [managing, setManaging] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const { data: lists = [], isLoading, isFetching, refetch, isError } = useQuery({ queryKey: ["admin-lists"], queryFn: commsApi.lists });

  const remove = useMutation({
    mutationFn: (l) => commsApi.deleteList(l._id),
    onSuccess: () => {
      toast.success("Email list deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-lists"] });
      queryClient.invalidateQueries({ queryKey: ["admin-mail-stats"] });
    },
    onError: () => toast.error("Failed to delete email list"),
    onSettled: () => setDeleting(null),
  });

  const exportList = useMutation({
    mutationFn: (l) => commsApi.exportList(l._id),
    onSuccess: (file) => {
      download(file);
      toast.success("Email list exported successfully!");
    },
    onError: () => toast.error("Failed to export email list"),
  });

  const open = (list = null) => {
    setEditing(list);
    setDialogOpen(true);
  };

  const q = search.toLowerCase();
  const shown = lists.filter((l) => l.name.toLowerCase().includes(q) || (l.description || "").toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-h3 font-semibold">
          <Icon name="mail" size={18} className="text-text-muted" />
          Email Lists ({lists.length})
        </h3>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching} title="Refresh counts" aria-label="Refresh counts">
            <Icon name="refresh" size={14} className={isFetching ? "animate-spin" : ""} />
          </Button>
          <Button onClick={() => open()}>+ Create List</Button>
        </div>
      </div>

      <SearchBox value={search} onChange={setSearch} placeholder="Search email lists..." />

      {isError && <p className="text-ui text-red">Failed to load email lists</p>}

      {isLoading ? (
        <Skeletons count={3} className="h-32" />
      ) : shown.length === 0 ? (
        <EmptyState
          icon="mail"
          title={search ? "No lists found" : "No email lists yet"}
          action={!search && <Button onClick={() => open()}>+ Create Your First List</Button>}
        >
          {search ? "Try a different search term" : "Create your first email list to organize recipients"}
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((l) => (
            <Card key={l._id} hover className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="truncate text-body font-semibold">{l.name}</h4>
                  {l.description && <p className="mt-1 line-clamp-2 text-ui text-text-muted">{l.description}</p>}
                </div>
                <Badge tone={l.isActive ? "green" : "neutral"}>{l.isActive ? "Active" : "Inactive"}</Badge>
              </div>

              <p className="flex items-center gap-2 text-ui text-text-muted">
                <Icon name="users" size={14} />
                <span className="font-medium text-text">
                  {l.memberCount} {l.memberCount === 1 ? "member" : "members"}
                </span>
              </p>

              {l.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {l.tags.map((tag) => (
                    <Badge key={tag} tone="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex gap-2 border-t border-border pt-3">
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => setManaging(l)}>
                  Members
                </Button>
                <Button variant="secondary" size="sm" onClick={() => open(l)} aria-label={`Edit ${l.name}`}>
                  Edit
                </Button>
                <Button variant="secondary" size="sm" onClick={() => exportList.mutate(l)} disabled={exportList.isPending} aria-label={`Export ${l.name}`}>
                  Export
                </Button>
                <Button variant="ghost" size="sm" className="text-red" onClick={() => setDeleting(l)} aria-label={`Delete ${l.name}`}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ListDialog open={dialogOpen} list={editing} onClose={() => setDialogOpen(false)} />
      <MembersDialog list={managing} onClose={() => setManaging(null)} />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete email list"
        message="Are you sure you want to delete this list? All members will be removed."
        busy={remove.isPending}
        onConfirm={() => remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
