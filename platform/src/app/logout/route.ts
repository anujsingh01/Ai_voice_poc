import { NextResponse } from 'next/server';
import { destroySession } from '@/lib/auth';

export async function POST(req: Request) {
  await destroySession();
  return NextResponse.redirect(new URL('/login?msg=signed_out', req.url), 303);
}
