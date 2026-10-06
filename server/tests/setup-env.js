/**
 * Test environment, set before anything reads it.
 *
 * ESM evaluates imports before the importing module's body, so assigning to
 * process.env inside a test file is too late - config/env.js has already been
 * evaluated by then. Importing this module first is the only ordering that
 * actually works.
 */
process.env.NODE_ENV = "test";
process.env.WEBHOOK_SECRET ||= "test-secret-not-a-real-one";
process.env.STORAGE_DRIVER ||= "local";
process.env.AVATAR_PROVIDER ||= "mock";

// Independent of whatever is in the developer's .env, so a local LiveKit or
// Anthropic key cannot change what the suite exercises.
process.env.LIVEKIT_URL = "";
process.env.LIVEKIT_API_KEY = "";
process.env.LIVEKIT_API_SECRET = "";
process.env.ANTHROPIC_API_KEY = "";

// Pinned rather than inherited, so a developer's own .env cannot change what
// the suite exercises.
process.env.LEMONSLICE_API_KEY = "";
process.env.ADMIN_EMAILS = "admin@example.com";

// No real mail from a test run, whatever is in the developer's .env: with no
// key every send answers "Email is not configured", which is what the
// invitation and plan-update tests expect.
process.env.RESEND_API_KEY = "";

// A made-up client id; tests/integration/google-auth.test.js signs its own
// tokens for it with a key it pretends Google published.
process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";

// Likewise no real image or chat calls (and no spend) from a run: tests that
// need the Kie.ai key set one on `env.kie` themselves.
process.env.KIE_API_KEY = "";
