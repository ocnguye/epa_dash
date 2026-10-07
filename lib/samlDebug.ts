// Temporary SAML debugging. Remove when finished.
//
// SAML_DEBUG=keys
//   -> names + value types
//
// SAML_DEBUG=values
//   -> names + values (truncated)
//
// This intentionally does NOT print the entire raw SAML response,
// since it may contain identifying information.

const MAX = 500;

function show(v: unknown, withValues: boolean): string {
  if (!withValues) {
    if (Array.isArray(v)) return `array(${v.length})`;
    return typeof v;
  }

  if (v === undefined) return 'undefined';
  if (v === null) return 'null';

  try {
    const s = JSON.stringify(v);
    return s.length > MAX
      ? `${s.slice(0, MAX)}…(${s.length} chars)`
      : s;
  } catch {
    return String(v);
  }
}

export function logSamlProfile(profile: any, rawSamlResponse?: string) {
  const mode = process.env.SAML_DEBUG;

  if (!mode) return;

  const withValues = mode === 'values';

  console.log('[SAML DEBUG] ===== START =====');

  // ------------------------------------------------------------
  // PROFILE OBJECT
  // ------------------------------------------------------------

  console.log('[SAML DEBUG] profile exists:', !!profile);

  const profileKeys = Object.keys(profile ?? {});

  console.log('[SAML DEBUG] profile keys:', profileKeys);

  // Print every top-level profile field
  console.log('[SAML DEBUG] profile fields:');

  for (const key of profileKeys) {
    const value = profile?.[key];

    // Don't dump function bodies
    if (typeof value === 'function') {
      console.log(`  ${key}: [function]`);
      continue;
    }

    console.log(`  ${key}: ${show(value, withValues)}`);
  }

  // ------------------------------------------------------------
  // IMPORTANT SAML IDENTITY FIELDS
  // ------------------------------------------------------------

  console.log('[SAML DEBUG] ===== IDENTITY FIELDS =====');

  console.log(
    '  issuer:',
    show(profile?.issuer, withValues)
  );

  console.log(
    '  nameID:',
    show(profile?.nameID, withValues)
  );

  console.log(
    '  nameIDFormat:',
    show(profile?.nameIDFormat, withValues)
  );

  console.log(
    '  nameQualifier:',
    show(profile?.nameQualifier, withValues)
  );

  console.log(
    '  spNameQualifier:',
    show(profile?.spNameQualifier, withValues)
  );

  console.log(
    '  inResponseTo:',
    show(profile?.inResponseTo, withValues)
  );

  console.log(
    '  sessionIndex:',
    show(profile?.sessionIndex, withValues)
  );

  // ------------------------------------------------------------
  // ATTRIBUTES
  // ------------------------------------------------------------

  const attributes = profile?.attributes ?? {};
  const attributeKeys = Object.keys(attributes);

  console.log('[SAML DEBUG] ===== ATTRIBUTES =====');

  console.log(
    '[SAML DEBUG] attribute count:',
    attributeKeys.length
  );

  console.log(
    '[SAML DEBUG] attribute keys:',
    attributeKeys
  );

  for (const key of attributeKeys) {
    console.log(
      `  ${key}: ${show(attributes[key], withValues)}`
    );
  }

  // ------------------------------------------------------------
  // COMMON EMAIL / IDENTITY ALIASES
  // ------------------------------------------------------------

  console.log('[SAML DEBUG] ===== COMMON IDENTITY VALUES =====');

  console.log(
    '  profile.mail:',
    show(profile?.mail, withValues)
  );

  console.log(
    '  profile.email:',
    show(profile?.email, withValues)
  );

  console.log(
    '  attributes.mail:',
    show(attributes?.mail, withValues)
  );

  console.log(
    '  attributes.email:',
    show(attributes?.email, withValues)
  );

  // ------------------------------------------------------------
  // PPID
  // ------------------------------------------------------------

  console.log('[SAML DEBUG] ===== PPID CHECK =====');

  console.log(
    '  profile.ppid:',
    show(profile?.ppid, withValues)
  );

  console.log(
    '  profile[urn:oid:2.5.4.5]:',
    show(profile?.['urn:oid:2.5.4.5'], withValues)
  );

  console.log(
    '  attributes.ppid:',
    show(attributes?.ppid, withValues)
  );

  console.log(
    '  attributes[urn:oid:2.5.4.5]:',
    show(attributes?.['urn:oid:2.5.4.5'], withValues)
  );

  console.log(
    '  has PPID OID:',
    attributeKeys.includes('urn:oid:2.5.4.5')
  );

  // ------------------------------------------------------------
  // ASSERTION / SAML METHODS
  // ------------------------------------------------------------

  console.log('[SAML DEBUG] ===== SAML METHODS =====');

  console.log(
    '  getAssertionXml:',
    typeof profile?.getAssertionXml
  );

  console.log(
    '  getAssertion:',
    typeof profile?.getAssertion
  );

  console.log(
    '  getSamlResponseXml:',
    typeof profile?.getSamlResponseXml
  );

  // ------------------------------------------------------------
  // RAW SAML RESPONSE
  // ------------------------------------------------------------

  console.log('[SAML DEBUG] ===== RAW SAML RESPONSE =====');

  console.log(
    '  response exists:',
    !!rawSamlResponse
  );

  if (rawSamlResponse) {
    console.log(
      '  response length:',
      rawSamlResponse.length
    );

    try {
      const xml = Buffer
        .from(rawSamlResponse, 'base64')
        .toString('utf8');

      console.log(
        '  decoded XML length:',
        xml.length
      );

      console.log(
        '  contains PPID OID:',
        xml.includes('urn:oid:2.5.4.5')
      );

      console.log(
        '  contains "ppid":',
        xml.toLowerCase().includes('ppid')
      );

      // Print all raw SAML Attribute Name/FriendlyName pairs.
      console.log(
        '[SAML DEBUG] raw Attribute Name -> FriendlyName:'
      );

      for (const match of xml.matchAll(
        /<(?:\w+:)?Attribute\s+([^>]*)>/g
      )) {
        const attrs = match[1];

        const name =
          attrs.match(/\bName="([^"]*)"/)?.[1];

        const friendly =
          attrs.match(/\bFriendlyName="([^"]*)"/)?.[1];

        console.log(
          `  ${name ?? '(no Name)'} -> ${friendly ?? '(none)'}`
        );
      }

    } catch (err) {
      console.error(
        '[SAML DEBUG] raw decode error:',
        err
      );
    }
  }

  console.log('[SAML DEBUG] ===== END =====');
}