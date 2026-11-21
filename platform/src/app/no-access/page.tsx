import { AuthCard } from '@/components/ui';

export default function NoAccess() {
  return (
    <AuthCard title="No access" subtitle="Your account isn’t linked to any company on this platform yet.">
      <p className="text-sm text-slate-600 mb-4">Ask your company’s administrator to add you.</p>
      <form action="/logout" method="post"><button className="text-sm text-brand-700 hover:underline">Sign out</button></form>
    </AuthCard>
  );
}
