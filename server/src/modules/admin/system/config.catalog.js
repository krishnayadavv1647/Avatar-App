/**
 * Every setting the App Config tab can edit: its label, help text, default and
 * how a value is checked. The form is drawn from this list and saving is
 * validated against it, so adding a setting is one entry here.
 *
 * Values are stored as strings in SystemConfig. An empty stored value means
 * "use the default", which is how unset branding leaves the app looking
 * exactly as it did before anyone touched the panel.
 *
 * `public` marks the subset GET /api/config may show to signed-out visitors.
 *
 * Types:
 *   text    plain text, up to `max` characters
 *   url     http(s) address
 *   media   http(s) address, or a path on this site (a stored upload)
 *   email   an email address
 *   youtube http(s) address; YouTube watch/short links are stored as /embed/ links
 */
export const CONFIG_SECTIONS = {
  app: { title: "App Configuration", description: "Configure your app's public name, support contact and welcome videos." },
  branding: { title: "Branding Settings", description: "Customize your app's logo and favicon." },
};

export const CONFIG_CATALOG = [
  {
    key: "app_name",
    section: "app",
    label: "Application Name",
    description: "The name of your application",
    type: "text",
    max: 60,
    default: "Avatar Studio",
    placeholder: "My Awesome App",
    public: true,
  },
  {
    key: "app_public_domain",
    section: "app",
    label: "App Public Domain",
    description: "The primary address of your app (e.g., https://app.example.com). Used to build the MCP server address.",
    type: "url",
    default: "",
    placeholder: "https://app.example.com",
  },
  {
    key: "buy_plan_url",
    section: "app",
    label: "Buy Plan URL",
    description: "External URL where users can buy a plan or more minutes",
    type: "url",
    default: "",
    placeholder: "https://your-payment-provider.com/buy",
    public: true,
  },
  {
    key: "support_email",
    section: "app",
    label: "Support Email",
    description: "Contact email for user support",
    type: "email",
    default: "",
    placeholder: "support@example.com",
    public: true,
  },
  {
    key: "welcome_video_url",
    section: "app",
    label: "Welcome Video URL",
    description: "Paste any YouTube URL (e.g., https://youtu.be/VIDEO_ID). It will be converted automatically. Leave empty to disable.",
    type: "youtube",
    default: "",
    placeholder: "https://www.youtube.com/watch?v=YOUR_VIDEO_ID or https://youtu.be/YOUR_VIDEO_ID",
    public: true,
  },
  {
    key: "walkthrough_video_url",
    section: "app",
    label: "Walkthrough Video URL",
    description: "Paste any YouTube URL (e.g., https://youtu.be/VIDEO_ID). It will be converted automatically. Leave empty to disable.",
    type: "youtube",
    default: "",
    placeholder: "https://www.youtube.com/watch?v=YOUR_VIDEO_ID or https://youtu.be/YOUR_VIDEO_ID",
    public: true,
  },
  {
    key: "logo_url",
    section: "branding",
    label: "App Logo URL",
    description: "URL for your app's logo (leave empty for the default)",
    type: "media",
    default: "",
    public: true,
  },
  {
    key: "favicon_url",
    section: "branding",
    label: "Favicon URL",
    description: "URL for the site favicon (leave empty for the default)",
    type: "media",
    default: "",
    public: true,
  },
];

export const CONFIG_BY_KEY = new Map(CONFIG_CATALOG.map((c) => [c.key, c]));

/** Cost rules live beside the catalog in SystemConfig but are not a form field. */
export const COST_RULES_KEY = "api_cost_rules";

const isHttpUrl = (value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

/** A YouTube watch / youtu.be link as its /embed/ form; anything else unchanged. */
export function youtubeToEmbed(url) {
  if (!url) return url;
  if (url.includes("youtube.com/embed/")) return url;
  let id = null;
  if (url.includes("youtube.com/watch?v=")) id = url.split("v=")[1]?.split("&")[0];
  else if (url.includes("youtu.be/")) id = url.split("youtu.be/")[1]?.split("?")[0];
  return id ? `https://www.youtube.com/embed/${id}` : url;
}

/**
 * Checks and normalises one value for its setting.
 * @returns {{ value: string } | { error: string }}
 */
export function checkSetting(def, raw) {
  const value = String(raw ?? "").trim();
  if (value === "") return { value: "" };

  switch (def.type) {
    case "text":
      return value.length > def.max ? { error: `${def.label} must be ${def.max} characters or fewer` } : { value };
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
        ? { value }
        : { error: `${def.label} must be a valid email address` };
    case "media":
      if (value.length > 2048) return { error: `${def.label} is too long` };
      return isHttpUrl(value) || /^\/(?!\/)/.test(value)
        ? { value }
        : { error: `${def.label} must start with http:// or https://` };
    case "url":
    case "youtube":
      if (value.length > 2048) return { error: `${def.label} is too long` };
      if (!isHttpUrl(value)) return { error: `${def.label} must start with http:// or https://` };
      return { value: def.type === "youtube" ? youtubeToEmbed(value) : value };
    default:
      return { value };
  }
}
