'use strict';

const { withTenant } = require('../db/tenant');

async function getConsent(pg, tenantId, subjectId) {
  const { rows } = await pg.query(
    'SELECT id, created_at, reinforced_regions FROM aesthetic_consent WHERE subject_id = $1 AND tenant_id = $2',
    [subjectId, tenantId]
  );
  return rows[0] || null;
}

async function createConsent(pg, { tenantId, subjectId, userId, notes, reinforcedRegions, ip, userAgent }) {
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO aesthetic_consent
         (tenant_id, subject_id, user_id, ip, user_agent, notes, reinforced_regions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, subject_id) DO UPDATE SET
         reinforced_regions = CASE
           WHEN aesthetic_consent.reinforced_regions IS NULL THEN EXCLUDED.reinforced_regions
           ELSE ARRAY(SELECT DISTINCT unnest(aesthetic_consent.reinforced_regions || EXCLUDED.reinforced_regions))
         END,
         notes = COALESCE(EXCLUDED.notes, aesthetic_consent.notes)
       RETURNING id, created_at, reinforced_regions`,
      [tenantId, subjectId, userId, ip, userAgent, notes, reinforcedRegions || []]
    );
    return rows[0];
  }, { userId, channel: 'ui' });
}

module.exports = { getConsent, createConsent };
