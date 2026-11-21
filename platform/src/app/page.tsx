import { redirect } from 'next/navigation';
import { homeFor, requireUser } from '@/lib/auth';

export default async function Home() {
  const { user, memberships } = await requireUser();
  redirect(homeFor(user, memberships));
}
