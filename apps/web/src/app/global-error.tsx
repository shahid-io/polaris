'use client';

/**
 * Last-resort error boundary.
 *
 * Catches failures in the root layout itself, which `error.tsx` cannot, at that point the
 * layout has not rendered, so this component must supply its own `html` and `body`.
 *
 * For the same reason it cannot rely on the application's stylesheet or components: if the
 * layout failed, the CSS may never have loaded. Styles here are inline and deliberately
 * minimal, and the palette is neutral enough to stay legible on either theme.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#f4f6f9',
          color: '#0e1520',
        }}
      >
        <main style={{ maxWidth: '28rem', padding: '1.5rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>
            Polaris could not start
          </h1>
          <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#59657a' }}>
            A problem prevented the application from loading. Reloading usually resolves it.
          </p>
          {error.digest && (
            <p
              style={{
                marginTop: '0.75rem',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.75rem',
                color: '#59657a',
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: '1.25rem',
              padding: '0.5rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#ffffff',
              background: '#2b5aa0',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
