import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal" role="alert">
        <h1>Chripify could not display this screen.</h1>
        <p>Restart the application. Any existing recordings remain on your device.</p>
      </main>
    ) : (
      this.props.children
    );
  }
}
const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
