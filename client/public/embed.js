/**
 * Avatar Studio website widget.
 *
 *   <script src="https://YOUR-APP/embed.js" data-token="SHARE_TOKEN" async></script>
 *
 * Adds a round button in a corner of the page; clicking it opens the avatar in
 * a panel (an iframe of /embed/:token). Plain script, no dependencies, so it
 * drops into any site.
 *
 * Optional attributes:
 *   data-position  "right" (default) or "left"
 *   data-name      visitor's name, e.g. from your own login - skips asking
 *   data-email     visitor's email
 *   data-label     button tooltip, default "Talk to us"
 *   data-color     button colour, default "#ff4fa3"
 *
 * From your own code: window.AvatarApp.open() / .close() / .toggle(), and
 * window "message" events { source: "avatar-app", type: "call-started" |
 * "call-ended" } while a call starts and ends.
 */
(function () {
  var script = document.currentScript;
  if (!script || window.AvatarApp) return;

  var token = script.getAttribute("data-token");
  if (!token) {
    console.error("[avatar-app] embed.js needs a data-token attribute.");
    return;
  }

  var origin = new URL(script.src, window.location.href).origin;
  var side = script.getAttribute("data-position") === "left" ? "left" : "right";
  var color = script.getAttribute("data-color") || "#ff4fa3";
  var label = script.getAttribute("data-label") || "Talk to us";

  var query = [];
  ["name", "email"].forEach(function (key) {
    var value = script.getAttribute("data-" + key);
    if (value) query.push(key + "=" + encodeURIComponent(value));
  });
  var src = origin + "/embed/" + encodeURIComponent(token) + (query.length ? "?" + query.join("&") : "");

  var button = document.createElement("button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 ' +
    '2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  style(button, {
    position: "fixed",
    bottom: "20px",
    width: "60px",
    height: "60px",
    borderRadius: "50%",
    border: "0",
    background: color,
    cursor: "pointer",
    boxShadow: "0 6px 24px rgba(0,0,0,.25)",
    zIndex: "2147483000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });
  button.style[side] = "20px";

  var panel = document.createElement("div");
  style(panel, {
    position: "fixed",
    bottom: "92px",
    width: "min(400px, calc(100vw - 32px))",
    height: "min(660px, calc(100vh - 120px))",
    borderRadius: "16px",
    overflow: "hidden",
    boxShadow: "0 12px 48px rgba(0,0,0,.35)",
    zIndex: "2147483000",
    display: "none",
    background: "#0a0a0a",
  });
  panel.style[side] = "20px";

  var frame = null;
  var isOpen = false;

  function open() {
    // The iframe is created on first open, so a page that never opens the
    // widget never loads the app or asks for the microphone.
    if (!frame) {
      frame = document.createElement("iframe");
      frame.src = src;
      frame.title = label;
      frame.allow = "microphone; camera; autoplay; clipboard-write";
      style(frame, { width: "100%", height: "100%", border: "0" });
      panel.appendChild(frame);
    }
    panel.style.display = "block";
    isOpen = true;
  }

  function close() {
    panel.style.display = "none";
    isOpen = false;
  }

  button.addEventListener("click", function () {
    isOpen ? close() : open();
  });

  function mount() {
    document.body.appendChild(panel);
    document.body.appendChild(button);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  window.AvatarApp = {
    open: open,
    close: close,
    toggle: function () {
      isOpen ? close() : open();
    },
  };

  function style(el, props) {
    for (var key in props) el.style[key] = props[key];
  }
})();
