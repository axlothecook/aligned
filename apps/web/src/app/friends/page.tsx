'use client';
// Placeholder — the real friends UI (add by tag, requests, list) comes next.
import { useAuth } from '@/lib/auth';

export default function FriendsPage() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <p style={{ marginTop: '2rem' }}>Please log in.</p>;
  return (
    <section style={{ paddingTop: '2rem' }}>
      <h1>Friends</h1>
      <p style={{ color: 'var(--ink-dim)' }}>Add friends by their tag and manage requests here.</p>
    </section>
  );
}
