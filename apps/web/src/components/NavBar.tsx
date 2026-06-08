'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import styles from './NavBar.module.scss';

export function NavBar() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  return (
    <nav className={styles.nav}>
      <Link href="/" className={styles.brand}>
        Aligned
      </Link>
      <div className={styles.links}>
        {loading ? null : user ? (
          <>
            <Link href="/calendars">Calendars</Link>
            <Link href="/friends">Friends</Link>
            <span className={styles.tag}>{user.tag}</span>
            <button
              className="btn-ghost"
              onClick={async () => {
                await logout();
                router.push('/');
              }}
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link href="/login">Log in</Link>
            <Link href="/signup">Sign up</Link>
          </>
        )}
      </div>
    </nav>
  );
}
