# team

The people in a workspace. Mounted at `/api/team` (owners and admins only).

- `GET /members` - everyone in the workspace, owner first, plus who is asking.
- `POST /members` - make an account that signs in at once (`name`, `email`, `password` of 10+ characters, `role`: `admin` or `member`). It joins the creator's workspace instead of getting one of its own, and shares its avatars, plan and credits.
- `PATCH /members/:id` - `name`, `title`, `role`.
- `POST /members/:id/password` - set a new password; the person is signed out everywhere.
- `DELETE /members/:id` - removes the account.

Who may do what to whom is in `team.service.js`: the owner manages admins and members; an admin manages members only; nobody changes the owner or themselves here (that is `/api/profile`). A role is read from the database on each request (`middleware/teamRole.js`), not from the token, so a promotion or a removal takes effect at once; `middleware/workspace.js` also rejects a token whose person is no longer in that workspace. Buying credits (`POST /api/billing/checkout`) needs the same owner-or-admin role. Every change is written to the workspace's audit log (`team.*`).

## Invite links

A link lets someone make their own account inside the workspace, with a role set on it.

- `GET /invites` - links that still work (never the token). `POST /invites` - `role`, `expiresInDays` (1, 7 or 30), `maxUses` (1-50), optional `email` to lock it to one address (then single use); answers with the `link` once - only a hash is stored. `DELETE /invites/:id` - cancels (an admin cancels their own; the owner any). At most 25 open per workspace.
- Public, at `/api/join/:token`: `GET` says where you would join and as what (410 with a reason when used up, expired or cancelled); `POST` (`name`, `email`, `password`) makes the account **in that workspace** (not a new one) and returns a signed-in session. A use is claimed atomically first, so a single-use link cannot be opened by two people at once, and is given back if the account cannot be made.
- New accounts only: a person belongs to one workspace, so an existing email is refused rather than moved out of its own workspace.
- Code: `invite.service.js`, `join.routes.js`, model `TeamInvite`. Page: `client/src/features/team/JoinPage.jsx` at `/join/:token`.
