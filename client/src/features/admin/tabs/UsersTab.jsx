import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/services/admin.api";
import { adminUsersApi } from "@/services/admin.users.api";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Badge, Select } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import Icon from "../icons";
import { date } from "../format";
import CreateUserDialog from "../users/CreateUserDialog";
import EditUserDialog from "../users/EditUserDialog";
import ActAsUserDialog from "../users/ActAsUserDialog";
import { useActAsUser } from "../impersonation";
import { INPUT_CLASS, RowMenu, SOURCE_LABEL, SourceIcon, allowance } from "../users/userUi";

/**
 * Users & Access > Users: every account, with search, filters, an export, and
 * create / edit / delete.
 *
 * Search, filtering and paging happen on the server (30 a page), so this holds
 * one page at a time however many accounts there are. The CSV export uses the
 * same filters and covers every page.
 */
export default function UsersTab() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const act = useActAsUser();

  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState({ status: "all", plan: "all", source: "all" });
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Searches once typing pauses, from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const setFilter = (key) => (value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const active = { q, ...filters };
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ["admin-users", active, page],
    queryFn: () => adminUsersApi.list({ ...active, page }),
    placeholderData: keepPreviousData,
  });
  const { data: plans = [] } = useQuery({ queryKey: ["admin-plans"], queryFn: adminApi.plans });

  const refresh = () => {
    for (const key of ["admin-users", "admin-user", "admin-stats", "admin-plans"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const remove = useMutation({
    mutationFn: (user) => adminUsersApi.remove(user.id),
    onSuccess: () => {
      toast.success("User deleted successfully.");
      setDeleting(null);
      refresh();
    },
    onError: (err) => {
      toast.error("Failed to delete user.", { description: err.message });
      setDeleting(null);
    },
  });

  const exportCsv = async () => {
    setExporting(true);
    try {
      await adminUsersApi.exportCsv(active);
      toast.success(`Exported ${data?.total ?? 0} users to CSV`);
    } catch (err) {
      toast.error("Failed to export CSV", { description: err.message });
    } finally {
      setExporting(false);
    }
  };

  const users = data?.users ?? [];
  const from = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.page * data.pageSize, data.total) : 0;
  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-h3">User Management</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={exportCsv} disabled={exporting}>
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            {/* Bulk mail is its own tab; this just takes you there. */}
            <Button as={Link} to="/admin?tab=mailing" variant="secondary">
              Send Bulk Email
            </Button>
            <Button onClick={() => setCreating(true)}>Create User</Button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users..."
            aria-label="Search users"
            className={`${INPUT_CLASS} min-w-[200px] lg:flex-1`}
          />
          <div className="w-full lg:w-44">
            <Select value={filters.status} onChange={setFilter("status")} aria-label="Status">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </Select>
          </div>
          <div className="w-full lg:w-52">
            <Select value={filters.plan} onChange={setFilter("plan")} aria-label="Plan">
              <option value="all">All Plans</option>
              {plans.map((plan) => (
                <option key={plan._id} value={plan._id}>
                  {plan.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full lg:w-44">
            <Select value={filters.source} onChange={setFilter("source")} aria-label="Source">
              <option value="all">All Sources</option>
              <option value="invited">Invited</option>
              <option value="signup">Sign-up</option>
              <option value="manual">Manual</option>
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-h3">Users ({data ? data.total.toLocaleString() : "…"})</h2>
          <Badge tone="outline">{data ? data.activeTotal.toLocaleString() : "…"} Active</Badge>
        </div>

        {error && <p className="mt-4 text-ui text-red">{error.message}</p>}
        {isLoading && <p className="mt-4 text-ui text-text-muted">Loading users…</p>}

        {data && (
          <div className={isFetching ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <ul className="mt-4 space-y-3">
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  onEdit={() => setEditing(user)}
                  onDetails={() => navigate(`/admin/users/${user.id}`)}
                  onActAs={() => act.ask(user)}
                  onDelete={() => setDeleting(user)}
                />
              ))}
            </ul>

            {users.length === 0 && !isLoading && (
              <p className="py-8 text-center text-text-muted">No users found matching your filters.</p>
            )}

            {totalPages > 1 && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-ui text-text-muted">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <span className="flex items-center gap-4">
                  <span>
                    Showing {from} to {to} of {data.total.toLocaleString()} users
                  </span>
                  <span className="font-medium text-text">
                    Page {page} of {totalPages}
                  </span>
                </span>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <CreateUserDialog
        open={creating}
        plans={plans}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          refresh();
        }}
      />

      {editing && (
        <EditUserDialog
          key={editing.id}
          user={editing}
          plans={plans}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      <ActAsUserDialog act={act} />

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.email ?? "user"}?`}
        message={
          "This permanently deletes the account. If no one else uses their workspace, that goes too: " +
          `${deleting?.avatars ? `its ${deleting.avatars} avatar${deleting.avatars === 1 ? "" : "s"}, ` : "its avatars, "}` +
          "knowledge documents, MCP servers, share links, API keys and plan. Their live calls end now. " +
          "Call history and usage stay for billing, without names or transcripts. This cannot be undone."
        }
        confirmLabel="Delete User"
        busyLabel="Deleting…"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

/** One account: who they are, their badges, their minutes, and a menu. */
function UserRow({ user, onEdit, onDetails, onActAs, onDelete }) {
  const minutes = allowance(user);
  const initial = (user.name?.[0] || user.email[0]).toUpperCase();

  return (
    <li className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface-2 p-4">
      <div className="flex min-w-0 items-center gap-4">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ui font-semibold">
          {initial}
          <span
            title={SOURCE_LABEL[user.source]}
            className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-text-muted"
          >
            <SourceIcon source={user.source} />
          </span>
        </div>

        <div className="min-w-0">
          <h3 className="truncate text-ui font-semibold">{user.name || "New User"}</h3>
          <p className="truncate text-ui text-text-muted">{user.email}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={user.status === "active" ? "green" : "red"}>{user.status}</Badge>
            {user.admin && <Badge tone="purple">admin</Badge>}
            <Badge tone="outline">{user.plan || "No Plan"}</Badge>
            <Badge tone="outline">{SOURCE_LABEL[user.source]}</Badge>
            {user.organization && <Badge tone="outline">{user.organization}</Badge>}
            {user.workspace && (
              <Badge tone="blue">
                <Icon name="users" size={12} className="mr-1" />
                {user.workspace.name}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right text-ui">
          <p className="font-bold">{minutes.total}</p>
          <p className="text-label text-text-faint">{minutes.detail}</p>
          <p className="mt-1 text-text-muted">Joined {date(user.createdAt)}</p>
        </div>
        <RowMenu
          label={`Actions for ${user.email}`}
          items={[
            { label: "Edit User", onSelect: onEdit },
            { label: "View details", onSelect: onDetails },
            {
              label: "Act as user",
              onSelect: onActAs,
              disabled: user.admin,
              title: user.admin ? "Admins can't be impersonated." : "See the app as this user, and make changes for them.",
            },
            { separator: true },
            {
              label: "Delete User",
              danger: true,
              onSelect: onDelete,
              disabled: user.admin,
              title: user.admin ? "Admins cannot be deleted. Demote them first." : undefined,
            },
          ]}
        />
      </div>
    </li>
  );
}
