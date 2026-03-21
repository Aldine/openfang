export default function NotFoundPage() {
  return (
    <section style={{ padding: 32 }}>
      <h1 style={{ margin: '0 0 12px', fontSize: 32, fontWeight: 800 }}>Page not found</h1>
      <p style={{ margin: 0, color: 'var(--text-muted)' }}>
        The page you requested does not exist in this OpenFang workspace.
      </p>
    </section>
  );
}