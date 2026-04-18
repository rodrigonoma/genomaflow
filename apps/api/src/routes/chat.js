// apps/api/src/routes/chat.js
const crypto    = require('crypto');
const OpenAI    = require('openai');
const Anthropic = require('@anthropic-ai/sdk').default;

const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SESSION_TTL = 7200;  // 2h em segundos
const RESULT_TTL  = 300;   // 5min em segundos
const EMBED_TTL   = 3600;  // 1h em segundos

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Reciprocal Rank Fusion: funde listas de resultados semânticos e léxicos.
 * k=60 é o valor padrão da literatura.
 */
function rrf(semanticRows, lexicalRows, k = 60) {
  const scores = new Map();
  const all    = new Map();

  [...semanticRows, ...lexicalRows].forEach(r => all.set(r.id, r));

  semanticRows.forEach((r, i) => {
    scores.set(r.id, (scores.get(r.id) || 0) + 1 / (k + i + 1));
  });
  lexicalRows.forEach((r, i) => {
    scores.set(r.id, (scores.get(r.id) || 0) + 1 / (k + i + 1));
  });

  return [...all.values()]
    .sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0))
    .slice(0, 40);
}

module.exports = async function (fastify) {

  // POST /chat/message
  fastify.post('/message', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { question, session_id: incomingSessionId } = request.body || {};

    if (!question?.trim()) {
      return reply.status(400).send({ error: 'question é obrigatório' });
    }

    const session_id = incomingSessionId || crypto.randomUUID();
    const qHash      = hashText(question.trim());
    const resultKey  = `chat:result:${tenant_id}:${qHash}`;
    const embedKey   = `chat:embedding:${qHash}`;
    const sessionKey = `chat:session:${session_id}`;

    // --- Cache de resultado ---
    const cachedResult = await fastify.redis.get(resultKey);
    if (cachedResult) {
      const parsed = JSON.parse(cachedResult);
      await fastify.redis.lpush(sessionKey,
        JSON.stringify({ role: 'user',      content: question }),
        JSON.stringify({ role: 'assistant', content: parsed.answer })
      );
      await fastify.redis.ltrim(sessionKey, 0, 19);
      await fastify.redis.expire(sessionKey, SESSION_TTL);
      return { session_id, ...parsed };
    }

    // --- Embedding da query (com cache) ---
    let embedding;
    const cachedEmbed = await fastify.redis.get(embedKey);
    if (cachedEmbed) {
      embedding = JSON.parse(cachedEmbed);
    } else {
      const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: question.trim().slice(0, 8000)
      });
      embedding = res.data[0].embedding;
      await fastify.redis.setex(embedKey, EMBED_TTL, JSON.stringify(embedding));
    }

    const vecStr = `[${embedding.join(',')}]`;

    // --- Busca dual paralela ---
    const [semanticRes, lexicalRes] = await Promise.all([
      fastify.pg.query(
        `SELECT id, source_label, content, chunk_type
         FROM chat_embeddings
         WHERE tenant_id = $1
         ORDER BY embedding <=> $2::vector
         LIMIT 20`,
        [tenant_id, vecStr]
      ),
      fastify.pg.query(
        `SELECT id, source_label, content, chunk_type
         FROM chat_embeddings
         WHERE tenant_id = $1
           AND content_tsv @@ plainto_tsquery('portuguese', $2)
         ORDER BY ts_rank(content_tsv, plainto_tsquery('portuguese', $2)) DESC
         LIMIT 20`,
        [tenant_id, question]
      )
    ]);

    const top40 = rrf(semanticRes.rows, lexicalRes.rows);

    if (top40.length === 0) {
      return reply.status(200).send({
        session_id,
        answer: 'Não encontrei dados clínicos relevantes no sistema para responder essa pergunta.',
        sources: []
      });
    }

    // --- LLM-as-judge: Haiku seleciona top-5 ---
    let top5 = top40.slice(0, 5); // fallback se o judge falhar
    try {
      const judgeMsg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content:
            `Pergunta: "${question}"\n\n` +
            `Chunks disponíveis:\n` +
            top40.map((c, i) =>
              `[${i}] ID:${c.id}\nFonte: ${c.source_label}\n${c.content.slice(0, 400)}`
            ).join('\n\n') +
            `\n\nSelecione os 5 chunks mais relevantes para responder a pergunta.\n` +
            `Responda APENAS com JSON válido: {"ranked_ids":["id1","id2","id3","id4","id5"]}`
        }]
      });

      const parsed = JSON.parse(judgeMsg.content[0].text);
      const idMap  = new Map(top40.map(c => [c.id, c]));
      const ranked = (parsed.ranked_ids || []).map(id => idMap.get(id)).filter(Boolean);
      if (ranked.length > 0) top5 = ranked;
    } catch (_) {
      // judge falhou — usa top-5 do RRF
    }

    // --- Histórico da sessão (últimas 10 msgs) ---
    const rawHistory = await fastify.redis.lrange(sessionKey, 0, 9);
    const history    = rawHistory.reverse().map(h => JSON.parse(h));

    // --- LLM gerador: Sonnet produz resposta com citações ---
    const contextText = top5
      .map(c => `[${c.source_label}]\n${c.content}`)
      .join('\n\n');

    const genMsg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system:
        'Você é um assistente clínico do GenomaFlow. ' +
        'Responda perguntas sobre pacientes, exames e análises usando APENAS os dados fornecidos. ' +
        'Use linguagem clínica objetiva em português. ' +
        'Cite as fontes inline no formato [Fonte]. ' +
        'Nunca invente dados que não estejam no contexto.',
      messages: [
        ...history,
        {
          role: 'user',
          content: `Contexto clínico:\n${contextText}\n\nPergunta: ${question}`
        }
      ]
    });

    const answer  = genMsg.content[0].text;
    const sources = top5.map(c => ({
      type:          c.chunk_type,
      source_label:  c.source_label,
      chunk_excerpt: c.content.slice(0, 200)
    }));

    // --- Cacheia resultado + atualiza sessão ---
    await fastify.redis.setex(resultKey, RESULT_TTL, JSON.stringify({ answer, sources }));
    await fastify.redis.lpush(sessionKey,
      JSON.stringify({ role: 'user',      content: question }),
      JSON.stringify({ role: 'assistant', content: answer })
    );
    await fastify.redis.ltrim(sessionKey, 0, 19);
    await fastify.redis.expire(sessionKey, SESSION_TTL);

    return { session_id, answer, sources };
  });

  // DELETE /chat/session/:session_id
  fastify.delete('/session/:session_id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { session_id } = request.params;
    await fastify.redis.del(`chat:session:${session_id}`);
    return reply.status(204).send();
  });
};
