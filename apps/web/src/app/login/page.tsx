'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      router.push('/calendars');
    } catch (err: any) {
      setError(err?.message ?? 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ maxWidth: 400, margin: '2rem auto' }}>
      <h1>Log in</h1>
      <form onSubmit={onSubmit} className="card">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy} style={{ marginTop: '1rem', width: '100%' }}>
          {busy ? '…' : 'Log in'}
        </button>
      </form>
      <p style={{ marginTop: '1rem' }}>
        No account? <Link href="/signup">Sign up</Link>
      </p>
    </section>
  );
}
