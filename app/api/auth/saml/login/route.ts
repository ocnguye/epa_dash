import { NextResponse } from 'next/server';
import { getSaml } from '@/lib/saml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const url = await getSaml().getAuthorizeUrlAsync('', undefined, {});
    return NextResponse.redirect(url);
}