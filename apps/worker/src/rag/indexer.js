// apps/worker/src/rag/indexer.js
const { Pool }     = require('pg');
const OpenAI       = require('openai');
const { chunkText } = require('./chunker');

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Embeds an array of texts in batches of 100.
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts) {
  const embeddings = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100).map(t => t.slice(0, 8000));
    const res   = await openai.embeddings.create({ model: 'text-embedding-3-small', input: batch });
    embeddings.push(...res.data.map(d => d.embedding));
  }
  return embeddings;
}

/**
 * Builds a single text summary of a subject's clinical profile.
 * @param {object} s
 * @returns {string}
 */
function buildProfileContent(s) {
  const parts = [`Paciente: ${s.name || 'N/A'}`];
  if (s.sex)              parts.push(`Sexo: ${s.sex}`);
  if (s.birth_date)       parts.push(`Nascimento: ${new Date(s.birth_date).toLocaleDateString('pt-BR')}`);
  if (s.weight)           parts.push(`Peso: ${s.weight}kg`);
  if (s.species)          parts.push(`Espécie: ${s.species}`);
  if (s.medications)      parts.push(`Medicamentos: ${s.medications}`);
  if (s.comorbidities)    parts.push(`Comorbidades: ${s.comorbidities}`);
  if (s.allergies)        parts.push(`Alergias: ${s.allergies}`);
  if (s.family_history)   parts.push(`Histórico familiar: ${s.family_history}`);
  return parts.join(' | ');
}

/**
 * Indexes all clinical chunks for an exam into chat_embeddings.
 * Called after exam processing succeeds.
 * @param {string} exam_id
 * @param {string} tenant_id
 */
async function indexExam(exam_id, tenant_id) {
  const client = await pool.connect();
  try {
    // Fetch clinical results
    const { rows: results } = await client.query(
      `SELECT id, agent_type, interpretation, alerts, recommendations
       FROM clinical_results
       WHERE exam_id = $1 AND tenant_id = $2`,
      [exam_id, tenant_id]
    );

    // Fetch subject + exam date
    const { rows: examRows } = await client.query(
      `SELECT s.id AS subject_id, s.name, s.birth_date, s.sex, s.weight,
              s.species, s.medications, s.comorbidities, s.allergies,
              s.family_history, e.created_at AS exam_date
       FROM exams e
       JOIN subjects s ON s.id = e.subject_id
       WHERE e.id = $1`,
      [exam_id]
    );
    if (!examRows.length) return;

    const row         = examRows[0];
    const subject_id  = row.subject_id;
    const examDateStr = new Date(row.exam_date).toLocaleDateString('pt-BR');
    const subjectName = row.name || 'Paciente';

    const chunks = [];

    for (const result of results) {
      const baseLabel = `${examDateStr} · ${subjectName} · ${result.agent_type}`;

      // Interpretation — chunk with overlap
      if (result.interpretation) {
        chunkText(result.interpretation).forEach(content => {
          chunks.push({
            tenant_id, subject_id,
            exam_id,   result_id: result.id,
            chunk_type: 'interpretation',
            content,
            source_label: baseLabel
          });
        });
      }

      // Alerts — atomic chunks
      const alerts = Array.isArray(result.alerts) ? result.alerts : [];
      alerts.forEach(alert => {
        const content = `Alerta ${(alert.severity || '').toUpperCase()}: ${alert.marker} = ${alert.value}`;
        chunks.push({
          tenant_id, subject_id,
          exam_id,   result_id: result.id,
          chunk_type: 'alert',
          content,
          source_label: `${baseLabel} [alerta]`
        });
      });

      // Recommendations — atomic chunks
      const recs = Array.isArray(result.recommendations) ? result.recommendations : [];
      recs.forEach(rec => {
        const content = rec.description || JSON.stringify(rec);
        chunks.push({
          tenant_id, subject_id,
          exam_id,   result_id: result.id,
          chunk_type: 'recommendation',
          content,
          source_label: `${baseLabel} [recomendação]`
        });
      });
    }

    // Patient profile — one chunk per subject (no exam_id/result_id)
    const profileContent = buildProfileContent(row);
    chunks.push({
      tenant_id, subject_id,
      exam_id:   null, result_id: null,
      chunk_type: 'patient_profile',
      content:    profileContent,
      source_label: `Perfil · ${subjectName}`
    });

    if (chunks.length === 0) return;

    // Embed all chunks in batches of 100
    const texts      = chunks.map(c => c.content);
    const embeddings = await embedBatch(texts);

    // Remove old exam chunks + old patient profile (will be replaced)
    await client.query(
      `DELETE FROM chat_embeddings WHERE exam_id = $1 AND tenant_id = $2`,
      [exam_id, tenant_id]
    );
    await client.query(
      `DELETE FROM chat_embeddings
       WHERE subject_id = $1 AND chunk_type = 'patient_profile' AND tenant_id = $2`,
      [subject_id, tenant_id]
    );

    // Insert new chunks
    for (let i = 0; i < chunks.length; i++) {
      const c   = chunks[i];
      const vec = `[${embeddings[i].join(',')}]`;
      await client.query(
        `INSERT INTO chat_embeddings
           (tenant_id, subject_id, exam_id, result_id, chunk_type,
            content, content_tsv, embedding, source_label)
         VALUES ($1, $2, $3, $4, $5, $6,
                 to_tsvector('portuguese', $6),
                 $7::vector, $8)`,
        [c.tenant_id, c.subject_id, c.exam_id, c.result_id, c.chunk_type,
         c.content, vec, c.source_label]
      );
    }

    console.log(`[indexer] Indexed ${chunks.length} chunks for exam ${exam_id}`);
  } finally {
    client.release();
  }
}

module.exports = { indexExam };
