'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export default function SignupPage() {
  const { signup } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ email: '', username: '', displayName: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signup(form);
      router.push('/calendars');
    } catch (err: any) {
      setError(err?.message ?? 'Sign up failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ maxWidth: 400, margin: '2rem auto' }}>
      <h1>Sign up</h1>
      <form onSubmit={onSubmit} className="card">
        <label htmlFor="displayName">Display name</label>
        <input id="displayName" value={form.displayName} onChange={set('displayName')} required />
        <label htmlFor="username">Username (your tag: name#1234)</label>
        <input id="username" value={form.username} onChange={set('username')} required />
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={form.email} onChange={set('email')} required />
        <label htmlFor="password">Password (min 8 chars)</label>
        <input id="password" type="password" value={form.password} onChange={set('password')} required />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy} style={{ marginTop: '1rem', width: '100%' }}>
          {busy ? '…' : 'Create account'}
        </button>
      </form>
      <p style={{ marginTop: '1rem' }}>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </section>
  );
}
