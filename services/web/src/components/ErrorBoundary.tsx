import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// App-wide error boundary. Without one, any render-time throw (a malformed
// API row, an unexpected null) blanks the entire SPA to a white screen with
// no recovery path. This catches it and offers a reload.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          <div style={{ maxWidth: 440, textAlign: 'center' }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Алдаа гарлаа</h1>
            <p style={{ color: '#64748b', marginBottom: 16, fontSize: 14 }}>
              Хуудсыг үзүүлэх явцад гэнэтийн алдаа гарлаа. Дахин ачаалаад үзнэ үү.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: '#2563eb',
                color: '#fff',
                border: 0,
                borderRadius: 8,
                padding: '8px 16px',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Дахин ачаалах
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
