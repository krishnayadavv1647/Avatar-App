import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import { adminApi } from "@/services/admin.api";
import { Badge, Checkbox, Label, Select } from "@/components/forms/controls";

export const DEFAULT_AUDIENCE = {
  mode: "all",
  status: "all",
  userIds: [],
  planIds: [],
  planMode: "with",
  listIds: [],
  excludeBounced: true,
};

const MODES = [
  { value: "all", label: "All Users" },
  { value: "selected_users", label: "Select Specific Users" },
  { value: "plans", label: "Filter by Plan" },
  { value: "lists", label: "Filter by Email List" },
];

const CheckList = ({ items, selected, onToggle, empty }) => (
  <div className="max-h-48 overflow-y-auto rounded border border-border bg-bg p-3">
    {items.length === 0 && <p className="text-ui text-text-muted">{empty}</p>}
    {items.map((item) => (
      <div key={item.id} className="py-1">
        <Checkbox checked={selected.includes(item.id)} onChange={() => onToggle(item.id)}>
          {item.label}
        </Checkbox>
      </div>
    ))}
  </div>
);

const toggled = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/**
 * Who a mailing goes to, chosen as criteria. The server turns these into
 * recipients when it sends, so what is picked here - not any address list the
 * browser holds - decides who gets the email.
 *
 * `simple` is the scheduled-email form: everyone, or a segment by status and
 * plan (on or off the chosen plans).
 */
export default function AudienceFields({ value, onChange, simple = false }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const [userSearch, setUserSearch] = useState("");

  const needsPlans = value.mode === "plans";
  const { data: plans = [] } = useQuery({ queryKey: ["admin-comms-plans"], queryFn: adminApi.plans, enabled: needsPlans });
  const { data: lists = [] } = useQuery({ queryKey: ["admin-lists"], queryFn: commsApi.lists, enabled: value.mode === "lists" });
  const { data: users = [] } = useQuery({
    queryKey: ["admin-audience-users", userSearch],
    queryFn: () => commsApi.audienceUsers(userSearch),
    enabled: value.mode === "selected_users",
    placeholderData: (previous) => previous,
  });

  const changeMode = (mode) => onChange({ ...DEFAULT_AUDIENCE, mode, excludeBounced: value.excludeBounced });

  const statusSelect = (
    <div>
      <Label htmlFor="aud-status">Status Filter</Label>
      <Select id="aud-status" value={value.status} onChange={(status) => set({ status })}>
        <option value="all">All Status</option>
        <option value="active">Active</option>
        <option value="suspended">Suspended</option>
      </Select>
    </div>
  );

  const planPicker = (
    <>
      <div>
        <Label>Select Plans</Label>
        <CheckList
          items={plans.map((p) => ({ id: p._id, label: p.name }))}
          selected={value.planIds}
          onToggle={(id) => set({ planIds: toggled(value.planIds, id) })}
          empty="No plans yet."
        />
      </div>
    </>
  );

  if (simple) {
    const segment = value.mode !== "all";
    return (
      <div className="space-y-4">
        <div>
          <Label htmlFor="aud-simple">Target Audience</Label>
          <Select id="aud-simple" value={segment ? "segment" : "all"} onChange={(v) => onChange(v === "all" ? { ...DEFAULT_AUDIENCE } : { ...DEFAULT_AUDIENCE, mode: "plans" })}>
            <option value="all">All Users</option>
            <option value="segment">Specific Segment</option>
          </Select>
        </div>
        {segment && (
          <div className="space-y-4 rounded-lg border border-border bg-bg p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {statusSelect}
              <div>
                <Label htmlFor="aud-planmode">Plans</Label>
                <Select id="aud-planmode" value={value.planMode} onChange={(planMode) => set({ planMode })}>
                  <option value="with">On any of the selected plans</option>
                  <option value="without">Not on any of the selected plans</option>
                </Select>
              </div>
            </div>
            {planPicker}
            <p className="text-label text-text-faint">With no plan ticked, every user matching the status is included.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor="aud-mode">Audience Selection Method</Label>
        <Select id="aud-mode" value={value.mode} onChange={changeMode}>
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>

      {value.mode === "all" && statusSelect}

      {value.mode === "selected_users" && (
        <div className="space-y-4">
          <p className="rounded-lg border border-border bg-bg p-3 text-ui text-text-muted">Search and select individual users to email</p>
          <input
            type="search"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Search by name or email..."
            aria-label="Search users"
            className="h-10 w-full rounded border border-border bg-bg px-3 text-ui text-text outline-none placeholder:text-text-faint focus:border-border-strong"
          />
          {value.userIds.length > 0 && (
            <div className="rounded-lg border border-green bg-green-dim p-3">
              <p className="mb-2 text-ui font-medium text-green">Selected Recipients ({value.userIds.length})</p>
              <p className="text-label text-text-muted">Click a selected row below to remove it. Selections are kept while you search.</p>
            </div>
          )}
          <div className="max-h-96 overflow-y-auto rounded border border-border p-3">
            {users.length === 0 ? (
              <p className="py-6 text-center text-ui text-text-muted">No users found</p>
            ) : (
              <div className="space-y-2">
                {users.map((u) => {
                  const picked = value.userIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => set({ userIds: toggled(value.userIds, u.id) })}
                      aria-pressed={picked}
                      className={`flex w-full items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors ${picked ? "border-pink bg-pink-dim" : "border-transparent bg-surface-2 hover:bg-surface-3"}`}
                    >
                      <input type="checkbox" checked={picked} readOnly tabIndex={-1} className="pointer-events-none" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui font-medium">{u.name || "No Name"}</span>
                        <span className="block truncate text-label text-text-muted">{u.email}</span>
                      </span>
                      <Badge tone="outline">{u.planName || "No Plan"}</Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {value.mode === "plans" && (
        <div className="space-y-4">
          {statusSelect}
          {planPicker}
        </div>
      )}

      {value.mode === "lists" && (
        <div>
          <Label>Select Email Lists</Label>
          <CheckList
            items={lists.filter((l) => l.isActive).map((l) => ({ id: l._id, label: `${l.name} (${l.memberCount})` }))}
            selected={value.listIds}
            onToggle={(id) => set({ listIds: toggled(value.listIds, id) })}
            empty="No active email lists yet."
          />
        </div>
      )}

      <div className="border-t border-border pt-4">
        <Checkbox checked={value.excludeBounced} onChange={(excludeBounced) => set({ excludeBounced })}>
          Exclude bounced email addresses
        </Checkbox>
      </div>
    </div>
  );
}
