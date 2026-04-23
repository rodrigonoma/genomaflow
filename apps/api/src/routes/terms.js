const { withTenant } = require('../db/tenant');

/**
 * Catálogo dos documentos legais.
 *
 * IMPORTANTE: quando um PDF mudar em apps/web/public/legal/:
 * 1. Incrementar a `version` aqui (ex: '1.0' → '1.1')
 * 2. Recomputar o SHA-256 do arquivo:
 *      sha256sum apps/web/public/legal/<arquivo>.pdf
 * 3. Atualizar o `content_hash` correspondente
 *
 * Incrementar a versão força todos os usuários a re-aceitarem no próximo login.
 * O hash bate com o PDF servido pelo frontend — se divergir, o aceite é recusado.
 */
const DOCUMENTS = [
  {
    type: 'contrato_saas',
    version: '1.2',
    title: 'Contrato SaaS',
    file: 'contrato_saas.pdf',
    content_hash: '55d768782660c012bb0b957f2d8542718d1ee1b9f17422ad29041c59874acf60',
  },
  {
    type: 'dpa',
    version: '1.2',
    title: 'DPA — Proteção de Dados',
    file: 'dpa.pdf',
    content_hash: 'b3313f53a8a804a735a343b53520abf83598851d8c17268ead188dfc050c110c',
  },
  {
    type: 'politica_incidentes',
    version: '1.2',
    title: 'Política de Incidentes',
    file: 'politica_incidentes.pdf',
    content_hash: '116fb20d8aefeeea3a8327eaf3e9fd2ea7740aecff0cb6c0e35e7a82f91a23a1',
  },
  {
    type: 'politica_seguranca',
    version: '1.2',
    title: 'Política de Segurança',
    file: 'politica_seguranca.pdf',
    content_hash: '3b5b2dd66a3824b09e16964b52420d09c92d2f0da60e3f617b22663b1c2c76a8',
  },
  {
    type: 'politica_uso_aceitavel',
    version: '1.2',
    title: 'Política de Uso Aceitável',
    file: 'politica_uso_aceitavel.pdf',
    content_hash: 'b624af09829fb0b4095a37f252f93f6032f087465f5c792cb78b47dc8d9c28c5',
  },
];

const DOCUMENTS_PUBLIC = DOCUMENTS.map(d => ({
  type: d.type,
  version: d.version,
  title: d.title,
  pdf_url: `/legal/${d.file}`,
  content_hash: d.content_hash,
}));

function getClientIp(request) {
  const xff = request.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return request.ip;
}

module.exports = async function (fastify) {

  // GET /terms/documents — lista os documentos ativos com hash e URL
  fastify.get('/documents', { preHandler: [fastify.authenticate] }, async () => DOCUMENTS_PUBLIC);

  // GET /terms/status — retorna lista de documentos ainda pendentes de aceite
  fastify.get('/status', { preHandler: [fastify.authenticate] }, async (request) => {
    const { user_id, tenant_id } = request.user;

    const accepted = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT document_type, version FROM terms_acceptance WHERE user_id = $1`,
        [user_id]
      );
      return rows;
    });

    const acceptedKey = new Set(accepted.map(a => `${a.document_type}:${a.version}`));
    const pending = DOCUMENTS_PUBLIC.filter(d => !acceptedKey.has(`${d.type}:${d.version}`));

    return {
      all_accepted: pending.length === 0,
      pending,
    };
  });

  // POST /terms/accept — registra aceite de um ou vários documentos
  // body: { acceptances: [{ document_type, version, content_hash }] }
  fastify.post('/accept', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { acceptances } = request.body || {};

    if (!Array.isArray(acceptances) || acceptances.length === 0) {
      return reply.status(400).send({ error: 'acceptances é obrigatório e deve ser um array não-vazio' });
    }

    const catalogByKey = new Map(DOCUMENTS.map(d => [`${d.type}:${d.version}`, d]));
    for (const a of acceptances) {
      const key = `${a.document_type}:${a.version}`;
      const doc = catalogByKey.get(key);
      if (!doc) return reply.status(400).send({ error: `Documento inválido: ${key}` });
      if (a.content_hash !== doc.content_hash) {
        return reply.status(409).send({ error: `Hash divergente para ${a.document_type}. Recarregue a página.` });
      }
    }

    const ip = getClientIp(request);
    const ua = request.headers['user-agent'] || null;

    await withTenant(fastify.pg, tenant_id, async (client) => {
      for (const a of acceptances) {
        await client.query(
          `INSERT INTO terms_acceptance
             (user_id, tenant_id, document_type, version, content_hash, ip, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, document_type, version) DO NOTHING`,
          [user_id, tenant_id, a.document_type, a.version, a.content_hash, ip, ua]
        );
      }
    });

    return reply.status(201).send({ ok: true, accepted: acceptances.length });
  });
};
