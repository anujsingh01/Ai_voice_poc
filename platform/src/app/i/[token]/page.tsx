import type { Metadata, Viewport } from 'next';
import { InterviewApp } from './interview-app';

export const metadata: Metadata = { title: 'Your interview', referrer: 'no-referrer' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#4f46e5' };

// Candidate interview, opened from the personal invite link. No account: the token is the key.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InterviewApp token={token} />;
}
