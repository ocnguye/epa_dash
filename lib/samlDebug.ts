// Temporary: logs which attributes the IdP releases. Remove when done.
// SAML_DEBUG=keys   -> attribute names + value types only
// SAML_DEBUG=values -> names + (truncated) values
const MAX = 200;

function show(v: unknown, withValues: boolean): string {
  if (!withValues) return Array.isArray(v) ? `array(${v.length})` : typeof v;
  const s = JSON.stringify(v);
  return s.length > MAX ? `${s.slice(0, MAX)}…(${s.length} chars)` : s;
}

export function logSamlProfile(profile: any, rawSamlResponse?: string) {
  const mode = process.env.SAML_DEBUG;
  if (!mode) return;
  const withValues = mode === 'values';

  const { attributes, ...top } = profile ?? {};

  console.log('[SAML DEBUG] profile fields (nameID, issuer, format, etc.):');
  for (const [k, v] of Object.entries(top)) {
    if (attributes && k in attributes) continue; // node-saml can copy attributes onto the profile; skip dupes
    console.log(`  ${k}: ${show(v, withValues)}`);
  }

  console.log('[SAML DEBUG] attributes released by the IdP:');
  for (const [k, v] of Object.entries(attributes ?? {})) {
    console.log(`  ${k}: ${show(v, withValues)}`);
  }

  // Raw XML: shows Name vs FriendlyName, which node-saml doesn't expose.
  if (rawSamlResponse) {
    try {
      const xml = Buffer.from(rawSamlResponse, 'base64').toString('utf8');
      if (xml.includes('EncryptedAssertion')) {
        console.log('[SAML DEBUG] assertion is encrypted; raw attribute names not readable here');
      } else {
        console.log('[SAML DEBUG] raw <Attribute> Name -> FriendlyName:');
        for (const m of xml.matchAll(/<(?:\w+:)?Attribute\s+([^>]*)>/g)) {
          const name = m[1].match(/\bName="([^"]*)"/)?.[1];
          const friendly = m[1].match(/FriendlyName="([^"]*)"/)?.[1];
          console.log(`  ${name} -> ${friendly ?? '(none)'}`);
        }
      }
    } catch {
      console.log('[SAML DEBUG] could not decode raw SAMLResponse');
    }
  }
}