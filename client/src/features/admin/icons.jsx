/**
 * Small stroke icons for the admin panel's nav, in the same style as the
 * sidebar's. One component, picked by name, so tabs.js can stay plain data.
 */
const PATHS = {
  users: "M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M11 3a2.2 2.2 0 0 1 0 4.4M12 10c1.7.3 2.8 1.6 2.8 3.5",
  invite: "M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M12.5 5v4M10.5 7h4",
  plan: "M2 5l3 2.5L8 3l3 4.5L14 5l-1 7H3z",
  layers: "M8 2L1.5 5.5 8 9l6.5-3.5zM1.5 8.5L8 12l6.5-3.5M1.5 11.5L8 15l6.5-3.5",
  image: "M2.5 3h11v10h-11zM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5M10.5 6a1 1 0 1 0 0-.01",
  bell: "M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14a1.5 1.5 0 0 0 3 0",
  mail: "M2 3.5h12v9H2zM2 4.5l6 4.5 6-4.5",
  inbox: "M2 9l2-5.5h8L14 9v4.5H2zM2 9h3.5l1 1.5h3L11 9h3",
  key: "M10 6.5a3 3 0 1 1-2.1-2.9M7.9 6.4L2 12.3V14h2v-1.5h1.5V11H7l1.2-1.2",
  chart: "M2 13h12M4.5 13V8M8 13V4m3.5 9V9.5",
  coins: "M8 2.5c3 0 5.5.9 5.5 2s-2.5 2-5.5 2-5.5-.9-5.5-2 2.5-2 5.5-2zM2.5 4.5v3c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-3M2.5 7.5v3c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-3",
  settings: "M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM8 1.5l.9 1.7 1.9-.4.5 1.9 1.8.8-.9 1.7.9 1.7-1.8.8-.5 1.9-1.9-.4L8 14.5l-.9-1.7-1.9.4-.5-1.9-1.8-.8.9-1.7-.9-1.7 1.8-.8.5-1.9 1.9.4z",
  alert: "M8 2L1.5 13.5h13zM8 6.5v3M8 11.5v.01",
  chevron: "M4 6l4 4 4-4",
  refresh: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3",
};

export default function Icon({ name, size = 16, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name] || PATHS.layers} />
    </svg>
  );
}
