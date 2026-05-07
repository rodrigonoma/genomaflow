'use strict';

let _messaging = null;

function getMessaging() {
  if (_messaging) return _messaging;
  const admin = require('firebase-admin');
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  _messaging = admin.messaging();
  return _messaging;
}

/**
 * Envia push notification para todos os dispositivos de um usuário.
 * Best-effort: nunca lança erro para não derrubar a request principal.
 */
async function sendToUser(pg, userId, { title, body, data = {} }) {
  try {
    const { rows } = await pg.query(
      'SELECT token FROM device_tokens WHERE user_id = $1',
      [userId]
    );
    if (!rows.length) return;

    const messaging = getMessaging();
    const messages = rows.map(({ token }) => ({
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      token
    }));

    const result = await messaging.sendEach(messages);

    // Remove tokens inválidos/expirados
    const expired = result.responses
      .map((r, i) => (!r.success && r.error?.code === 'messaging/registration-token-not-registered') ? rows[i].token : null)
      .filter(Boolean);

    if (expired.length) {
      await pg.query('DELETE FROM device_tokens WHERE token = ANY($1)', [expired]);
    }
  } catch (err) {
    console.error('[push] sendToUser error:', err.message);
  }
}

/**
 * Envia push para todos os usuários de um tenant.
 */
async function sendToTenant(pg, tenantId, { title, body, data = {} }) {
  try {
    const { rows } = await pg.query(
      'SELECT DISTINCT user_id FROM device_tokens WHERE tenant_id = $1',
      [tenantId]
    );
    await Promise.all(rows.map(({ user_id }) => sendToUser(pg, user_id, { title, body, data })));
  } catch (err) {
    console.error('[push] sendToTenant error:', err.message);
  }
}

module.exports = { sendToUser, sendToTenant };
