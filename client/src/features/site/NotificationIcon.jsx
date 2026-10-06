/**
 * The icons a notification can carry. The admin picks one by name from this
 * list (the server accepts exactly these), and an unknown name - an older
 * record, say - falls back to the bell.
 */
const PATHS = {
  Bell: "M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14a1.5 1.5 0 0 0 3 0",
  Sparkles: "M6 2l1.2 3.3L10.5 6.5 7.2 7.7 6 11 4.8 7.7 1.5 6.5l3.3-1.2zM12 9l.7 1.8 1.8.7-1.8.7L12 14l-.7-1.8-1.8-.7 1.8-.7z",
  AlertCircle: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 5v3.5M8 10.8v.01",
  Info: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 7.5V11M8 5.2v.01",
  CheckCircle: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM5.5 8.2l1.8 1.8 3.4-3.6",
  Gift: "M2.5 6h11v2h-11zM3.5 8h9v5.5h-9zM8 6v7.5M8 6S6.5 2.5 5 3.5 6 6 8 6zm0 0s1.5-3.5 3-2.5S10 6 8 6z",
  Zap: "M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z",
  Video: "M2 4.5h8v7H2zM10 7l4-2v6l-4-2",
  Heart: "M8 13.5S2 10 2 6a3 3 0 0 1 6-.7A3 3 0 0 1 14 6c0 4-6 7.5-6 7.5z",
  BookOpen: "M8 4C6.5 3 4.5 2.7 2 3v9c2.5-.3 4.5 0 6 1 1.5-1 3.5-1.3 6-1V3c-2.5-.3-4.5 0-6 1zM8 4v9",
  Shield: "M8 1.5l5 2v4c0 3-2 5.5-5 7-3-1.5-5-4-5-7v-4z",
  Users: "M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M11 3a2.2 2.2 0 0 1 0 4.4M12 10c1.7.3 2.8 1.6 2.8 3.5",
  CreditCard: "M1.5 4h13v8h-13zM1.5 7h13M4 10h2.5",
  Key: "M10 6.5a3 3 0 1 1-2.1-2.9M7.9 6.4L2 12.3V14h2v-1.5h1.5V11H7l1.2-1.2",
};

export const NOTIFICATION_ICONS = Object.keys(PATHS);

export default function NotificationIcon({ name, size = 16, className }) {
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
      <path d={PATHS[name] || PATHS.Bell} />
    </svg>
  );
}
