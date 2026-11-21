import React from "react";

export class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className="glass-panel recovery-panel" role="alert">
      <h2>The workspace could not load</h2><p>Reload to fetch the current app files and try again. Saved library tracks remain in local storage.</p>
      <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Reload Audio Studio</button>
    </section>;
    return this.props.children;
  }
}
