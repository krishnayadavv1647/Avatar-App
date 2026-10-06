import { Component } from "react";
import Button from "./Button";

/**
 * Catches a render error below it and shows a way out, instead of React
 * unmounting the whole app to a blank screen.
 *
 * `resetKey` clears the error when it changes (the route, say), so moving to
 * another page does not leave this one stuck on the message. `compact` is for
 * a panel inside a page rather than the whole content area.
 */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error("Screen crashed:", error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className={`flex flex-col items-center justify-center gap-3 text-center ${this.props.compact ? "px-6 py-16" : "min-h-[50vh] px-6"}`}
      >
        <h2 className="text-h3 font-semibold">Something went wrong</h2>
        <p className="max-w-[420px] text-ui text-text-muted">
          This screen hit a problem. Reloading usually fixes it; if it keeps happening, tell us what you were doing.
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}
