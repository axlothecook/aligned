'use client';
// Placeholder — the real calendars UI (list + create meetup) comes next.
import { useAuth } from '@/lib/auth';

export default function CalendarsPage() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <p style={{ marginTop: '2rem' }}>Please log in.</p>;
  return (
    <section style={{ paddingTop: '2rem' }}>
      <h1>Calendars</h1>
      <p style={{ color: 'var(--ink-dim)' }}>Your shared meetup calendars will appear here.</p>
    </section>
  );
}
