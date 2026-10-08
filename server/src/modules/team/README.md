# team

The people in a workspace. Mounted at `/api/team` (owners and admins only).

- `GET /members` - everyone in the workspace, owner first, plus who is asking.
- `POST /members` - make an account that signs in at once (`name`, `email`, `password` of 10+ characters, `role`: `admin` or `member`). It joins the creator's workspace instead of getting one of its own, and shares its avatars, plan and credits.
- `PATCH /members/:id` - `name`, `title`, `role`.
- `POST /members/:id/password` - set a new password; the person is signed out everywhere.
- `DELETE /members/:id` - removes the account.

Who may do what to whom is in `team.service.js`: the owner manages admins and members; an admin manages members only; nobody changes the owner or themselves here (that is `/api/profile`). A role is read from the database on each request (`middleware/teamRole.js`), not from the token, so a promotion or a removal takes effect at once; `middleware/workspace.js` also rejects a token whose person is no longer in that workspace. Buying credits (`POST /api/billing/checkout`) needs the same owner-or-admin role. Every change is written to the workspace's audit log (`team.*`).
