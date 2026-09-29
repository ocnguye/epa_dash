import fs from 'fs';
import { SAML } from '@node-saml/node-saml';

let instance: SAML | null = null;

export function getSaml() {
    if (!instance) {
        const key = fs.readFileSync(process.env.SAML_KEY_PATH!, 'utf8');
        const cert = fs.readFileSync(process.env.SAML_CERT_PATH!, 'utf8');
        instance = new SAML({
            issuer: `${process.env.BASE_URL}/api/auth/saml/metadata`,
            callbackUrl: `${process.env.BASE_URL}/api/auth/saml/callback`,
            entryPoint: process.env.IDP_SSO_URL!,
            idpIssuer: process.env.IDP_ENTITY_ID!,
            idpCert: process.env.IDP_CERT!,
            audience: `${process.env.BASE_URL}/api/auth/saml/metadata`,
            privateKey: key,
            publicCert: cert,
            signatureAlgorithm: 'sha256',
            identifierFormat: null,
            acceptedClockSkewMs: 5000,
        });
    }
    return instance;
}