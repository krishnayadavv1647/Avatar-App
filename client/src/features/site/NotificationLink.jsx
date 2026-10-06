import { Link } from "react-router-dom";

/**
 * A notification's link: an address outside the app opens in a new tab, a path
 * inside it navigates in place. `className` styles it as a button or a text link.
 */
export default function NotificationLink({ url, text, className, onNavigate }) {
  if (!url || !text) return null;

  if (/^https?:\/\//i.test(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
        {text} <span aria-hidden>↗</span>
      </a>
    );
  }

  return (
    <Link to={url.startsWith("/") ? url : `/${url}`} onClick={onNavigate} className={className}>
      {text} <span aria-hidden>→</span>
    </Link>
  );
}
