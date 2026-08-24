'use strict';

/**
 * Health checks — públicos, sem autenticação.
 *
 *   GET /health        liveness  — o processo está de pé e respondendo?
 *   GET /health/ready  readiness — dá pra mandar tráfego (pg + redis vivos)?
 *
 * Por que dois:
 *   O healthcheck do Docker usa o liveness. Ele NÃO pode depender de banco:
 *   se o Postgres cai, reiniciar a API não conserta nada — só troca uma pane
 *   por duas. O readiness existe pra monitoramento e pra quem for decidir
 *   rotear tráfego.
 *
 * Por que existe (incidente 24/08/2026):
 *   O healthcheck apontava pra `http://localhost:3000/api/auth/me`, com dois
 *   defeitos que sozinhos já reprovariam — `localhost` resolve ::1 primeiro
 *   (a API escuta em IPv4) e `/api/auth/me` exige token. Ficou `unhealthy`
 *   por 6 dias com FailingStreak de 17.731 enquanto a API funcionava. Alarme
 *   sempre vermelho é pior que alarme nenhum.
 *
 * Rota pública na borda (Caddy roteia /api/* daqui): a resposta não carrega
 * versão, hostname, env nem mensagem de erro — nada que ajude a mapear a
 * infraestrutura de fora.
 */

// Um check pendurado não pode segurar a resposta: quem chama health espera
// resposta rápida, e "não respondeu a tempo" é exatamente o que queremos saber.
const CHECK_TIMEOUT_MS = 2000;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  // `finally` limpa o timer nos DOIS caminhos. Limpar só no sucesso deixa o
  // timer pendurado quando o check falha rápido (ECONNREFUSED), e o processo
  // fica com handle aberto por CHECK_TIMEOUT_MS à toa.
  ]).finally(() => clearTimeout(timer));
}

module.exports = async function (fastify) {
  const healthRateLimit = {
    config: {
      rateLimit: { max: 120, timeWindow: '1 minute' },
    },
  };

  fastify.get('/health', healthRateLimit, async () => ({ status: 'ok' }));

  fastify.get('/health/ready', healthRateLimit, async (request, reply) => {
    const [postgres, redis] = await Promise.all([
      withTimeout(fastify.pg.query('SELECT 1'), CHECK_TIMEOUT_MS)
        .then(() => true)
        .catch((err) => {
          // O detalhe fica no log (interno), nunca na resposta (pública).
          request.log.error({ err, check: 'postgres' }, 'readiness check falhou');
          return false;
        }),
      withTimeout(fastify.redis.ping(), CHECK_TIMEOUT_MS)
        .then(() => true)
        .catch((err) => {
          request.log.error({ err, check: 'redis' }, 'readiness check falhou');
          return false;
        }),
    ]);

    const ready = postgres && redis;
    return reply
      .status(ready ? 200 : 503)
      .send({ status: ready ? 'ready' : 'degraded', checks: { postgres, redis } });
  });
};
