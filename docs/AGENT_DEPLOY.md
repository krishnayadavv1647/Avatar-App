# Deploying the agent worker to LiveKit Cloud

The agent worker joins every call and drives the avatar. It has to run all the
time, somewhere other than the API: Render's free instance (512 MB) is killed
for running out of memory as soon as the worker takes a call. LiveKit Cloud
hosts the worker itself, restarts it if it fails, and its free Build plan
includes 1,000 agent minutes a month.

The API stays on Render (Start Command `npm start`, API only). The two meet in
the same LiveKit project: the API dispatches calls to the agent named
`AGENT_NAME` (`avatar-agent`), and the worker registers under that name.

## One-time setup

1. Install the LiveKit CLI (Windows):

   ```
   winget install LiveKit.LiveKitCLI
   ```

   Close and reopen the terminal afterwards so `lk` is on the PATH.

2. Link the CLI to your LiveKit Cloud project. This opens a browser; pick the
   project the app uses (the one in `LIVEKIT_URL`):

   ```
   lk cloud auth
   ```

3. Make a secrets file **outside the repo** (the repo is public). It is
   `server/.env` without `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
   (LiveKit Cloud injects those), `NODE_ENV`, `PORT` and `CLIENT_ORIGIN`.
   It must include `MONGO_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
   `LEMONSLICE_API_KEY`, `AGENT_NAME` and the `R2_*` / `STORAGE_DRIVER` keys,
   plus `ANTHROPIC_API_KEY` / `ELEVENLABS_API_KEY` if you use them.

4. MongoDB Atlas -> Network Access must allow LiveKit Cloud to connect. Its
   addresses are not fixed, so this means `0.0.0.0/0`.

5. Create the agent, from the `server` folder (this uses `server/Dockerfile`
   and writes `server/livekit.toml`):

   ```
   cd server
   lk agent create --secrets-file C:\Users\HP\avatar-agent-secrets.env
   ```

## After that

- Ship new worker code: `lk agent deploy` (from `server`).
- Change a key: `lk agent update-secrets --secrets "KEY=value"`.
- Check it: `lk agent status`, and `lk agent logs` for a live tail.

Stop any worker running on a laptop (`npm run agent`) once the cloud one is
up, or calls will be shared between the two.

The `AGENT_IDLE_PROCESSES` / `AGENT_LOAD_THRESHOLD` / `AGENT_INIT_TIMEOUT_MS`
tuning is for small shared instances; leave it out here - LiveKit Cloud uses
its own defaults and ignores a custom load threshold.
