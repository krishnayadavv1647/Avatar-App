# profile

The signed-in person's own page. Mounted at `/api/profile`.

- `GET /` and `PATCH /` - `name`, `title`, `phone`, `timezone` (an IANA zone), and `workspaceName` (the owner only).
- `PUT /photo` (multipart `photo`) and `DELETE /photo` - a JPG, PNG or WebP up to 5 MB. The bytes are checked, not the claimed type. Stored under `<workspace>/profile/` and the old one is removed.
- `POST /password` - `currentPassword` (not needed for an account made through Google, which has none) and `newPassword`. Every other device is signed out; the response carries fresh tokens for this one.

The email is the sign-in and is not editable here.
