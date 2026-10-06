import { useMemo } from "react";
import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";
import "./quill.css";

const TOOLBARS = {
  // Notifications: headings, emphasis, lists and a link.
  basic: [[{ header: [1, 2, 3, false] }], ["bold", "italic", "underline", "strike"], [{ list: "ordered" }, { list: "bullet" }], ["link"], ["clean"]],
  // Email bodies: the above plus colour and images.
  full: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ color: [] }, { background: [] }],
    ["link", "image"],
    ["clean"],
  ],
};

/** Quill in the app's dark theme. Loaded lazily by RichText in shared.jsx. */
export default function QuillEditor({ value, onChange, placeholder, toolbar, height }) {
  const modules = useMemo(() => ({ toolbar: TOOLBARS[toolbar] || TOOLBARS.full }), [toolbar]);

  return (
    <div className="quill-dark" style={{ "--editor-h": `${height}px` }}>
      <ReactQuill theme="snow" value={value} onChange={onChange} modules={modules} placeholder={placeholder} />
    </div>
  );
}
