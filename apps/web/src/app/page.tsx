'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const { user, loading } = useAuth();

  return (
    <section style={{ paddingTop: '2rem' }}>
      <h1>Aligned</h1>
      <p style={{ color: 'var(--ink-dim)', fontSize: '1.1rem' }}>
        Find when you and your friends are all free — then plan to meet up.
      </p>

      {loading ? null : user ? (
        <p style={{ marginTop: '1.5rem' }}>
          Welcome back, <strong>{user.displayName}</strong>. Head to your{' '}
          <Link href="/calendars">calendars</Link> or <Link href="/friends">friends</Link>.
        </p>
      ) : (
        <p style={{ marginTop: '1.5rem' }}>
          <Link href="/signup" className="btn" style={{ marginRight: '0.75rem' }}>
            Get started
          </Link>
          <Link href="/login">Log in</Link>
        </p>
      )}
    </section>
  );
}
