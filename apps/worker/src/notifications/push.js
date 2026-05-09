'use strict';

/**
 * Worker push module — best-effort wrapper para FCM.
 *
 * Espelha apps/api/src/services/push.js. Necessário pelo worker para
 * notificar médico ao final do job de transcrição (encounter gerado por IA).
 *
 * Se `firebase-admin` não estiver instalado no worker (não está em package.json
 * por padrão pra reduzir tamanho da imagem), o lazy require falha e o catch
 * externo loga sem derrubar o flow. Push perde, encounter é gerado normalmente.
 *
 * Para habilitar push real do worker: adicionar `firebase-admin` em
 * apps/worker/package.json e configurar `FIREBASE_SERVICE_ACCOUNT` no task def.
 */

let _messaging = null;

function getMessaging() {
  if (_messaging) return _messaging;
  const admin = require('firebase-admin');
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  _messaging = admin.messaging();
  return _messaging;
}

/**
 * Envia push notification para todos os dispositivos de um usuário.
 * Best-effort: nunca lança erro para não derrubar a pipeline principal.
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
