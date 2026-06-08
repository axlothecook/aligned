import type { Metadata } from 'next';
import './globals.scss';
import { AuthProvider } from '@/lib/auth';
import { NavBar } from '@/components/NavBar';

export const metadata: Metadata = {
  title: 'Aligned',
  description: 'Find when you and your friends are all free.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <NavBar />
          <main className="container">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
