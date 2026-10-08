# team

`TeamPage` (`/team`, in the sidebar for owners and admins): the workspace's people, with a role picker, "Reset password" and "Remove" on the rows the signed-in person may manage (the server enforces the same rules). `AddMemberDialog` makes an account and then shows its email and password once, to pass on. `password.jsx` has the generator and the copy line.

`InviteLinkDialog` ("Invite by link") makes a link and shows it once; the page lists the open ones with "Cancel link". `JoinPage` (`/join/:token`, public, outside the shell) is what the link opens: it says who invited you and as what, then makes your account inside that workspace and signs you in.
