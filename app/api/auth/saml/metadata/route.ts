import fs from 'fs';
import { getSaml } from '@/lib/saml';

export const runtime = 'nodejs';

export async function GET() {
    const cert = fs.readFileSync(process.env.SAML_CERT_PATH!, 'utf8');
    const xml = getSaml().generateServiceProviderMetadata(cert, cert);
    return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}