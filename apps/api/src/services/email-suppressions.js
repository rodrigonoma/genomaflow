'use strict';

/**
 * Suppression list de emails — pra evitar enviar pra emails que deram bounce
 * permanente ou complaint (spam).
 *
 * Uso:
 *   const supp = require('./email-suppressions');
 *   if (await supp.isSuppressed(pg, email)) return; // skip envio
 *   await supp.add(pg, email, 'bounce_permanent', { ... });
 *
 * Mantém reputação do SES — AWS exige bounce <5% e complaint <0.1% pra
 * permanecer em production access.
 */

/**
 * Checa se email está na lista de suppression. Retorna true se está suprimido.
 */
async function isSuppressed(pg, email) {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.toLowerCase().trim();
  const { rows } = await pg.query(
    `SELECT 1 FROM email_suppressions WHERE LOWER(email) = $1 LIMIT 1`,
    [normalized]
  );
  return rows.length > 0;
}

/**
 * Adiciona email à lista. Idempotente via ON CONFLICT.
 */
async function add(pg, email, reason, opts = {}) {
  if (!email) return null;
  const normalized = String(email).toLowerCase().trim();
  const validReasons = ['bounce_permanent', 'bounce_transient', 'complaint', 'manual'];
  if (!validReasons.includes(reason)) throw new Error(`reason inválido: ${reason}`);

  const { bounceSubtype, rawPayload, source } = opts;
  const { rows } = await pg.query(
    `INSERT INTO email_suppressions (email, reason, bounce_subtype, raw_payload, source)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (LOWER(email)) DO UPDATE
       SET reason = EXCLUDED.reason,
           bounce_subtype = EXCLUDED.bounce_subtype,
           raw_payload = EXCLUDED.raw_payload
     RETURNING id`,
    [normalized, reason, bounceSubtype || null,
     rawPayload ? JSON.stringify(rawPayload) : null,
     source || 'ses_webhook']
  );
  return rows[0]?.id || null;
}

/**
 * Remove email da suppression list (admin manual).
 */
async function remove(pg, email) {
  if (!email) return false;
  const { rowCount } = await pg.query(
    `DELETE FROM email_suppressions WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  return rowCount > 0;
}

module.exports = { isSuppressed, add, remove };
