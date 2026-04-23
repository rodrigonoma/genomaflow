// apps/worker/src/rag/indexer.js
const { Pool }      = require('pg');
const OpenAI        = require('openai');
const { chunkText } = require('./chunker');

const pool   = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SPECIES_LABELS = {
  dog: 'Cão', cat: 'Gato', equine: 'Equino', bovine: 'Bovino',
  bird: 'Ave', reptile: 'Réptil', other: 'Outro'
};

async function embedBatch(texts) {
  const embeddings = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100).map(t => t.slice(0, 8000));
    const res   = await openai.embeddings.create({ model: 'text-embedding-3-small', input: batch });
    embeddings.push(...res.data.map(d => d.embedding));
  }
  return embeddings;
}

// ─── Exam indexer (existing) ──────────────────────────────────────────────────

async function indexExam(exam_id, tenant_id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant_id]);

    const { rows: results } = await client.query(
      `SELECT id, agent_type, interpretation, alerts, recommendations
       FROM clinical_results WHERE exam_id = $1 AND tenant_id = $2`,
      [exam_id, tenant_id]
    );
    const { rows: examRows } = await client.query(
      `SELECT s.id AS subject_id, s.name, s.birth_date, s.sex, s.weight,
              s.species, s.medications, s.comorbidities, s.allergies,
              s.family_history, e.created_at AS exam_date
       FROM exams e JOIN subjects s ON s.id = e.subject_id AND s.tenant_id = $2
       WHERE e.id = $1 AND e.tenant_id = $2`,
      [exam_id, tenant_id]
    );
    if (!examRows.length) { await client.query('ROLLBACK'); return; }

    const row         = examRows[0];
    const subject_id  = row.subject_id;
    const examDateStr = new Date(row.exam_date).toLocaleDateString('pt-BR');
    const subjectName = row.name || 'Paciente';
    const chunks      = [];

    for (const result of results) {
      const baseLabel = `${examDateStr} · ${subjectName} · ${result.agent_type}`;
      if (result.interpretation) {
        chunkText(result.interpretation).forEach(content => {
          chunks.push({ tenant_id, subject_id, exam_id, result_id: result.id,
            chunk_type: 'interpretation', content, source_label: baseLabel });
        });
      }
      (Array.isArray(result.alerts) ? result.alerts : []).forEach(alert => {
        chunks.push({ tenant_id, subject_id, exam_id, result_id: result.id,
          chunk_type: 'alert',
          content: `Alerta ${(alert.severity||'').toUpperCase()}: ${alert.marker} = ${alert.value}`,
          source_label: `${baseLabel} [alerta]` });
      });
      (Array.isArray(result.recommendations) ? result.recommendations : []).forEach(rec => {
        chunks.push({ tenant_id, subject_id, exam_id, result_id: result.id,
          chunk_type: 'recommendation',
          content: rec.description || JSON.stringify(rec),
          source_label: `${baseLabel} [recomendação]` });
      });
    }

    if (chunks.length === 0) { await client.query('ROLLBACK'); return; }
    const embeddings = await embedBatch(chunks.map(c => c.content));

    await client.query(`DELETE FROM chat_embeddings WHERE exam_id = $1 AND tenant_id = $2`, [exam_id, tenant_id]);
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]; const vec = `[${embeddings[i].join(',')}]`;
      await client.query(
        `INSERT INTO chat_embeddings
           (tenant_id, subject_id, exam_id, result_id, chunk_type, content, content_tsv, embedding, source_label)
         VALUES ($1,$2,$3,$4,$5,$6, to_tsvector('portuguese',$6), $7::vector,$8)`,
        [c.tenant_id, c.subject_id, c.exam_id, c.result_id, c.chunk_type, c.content, vec, c.source_label]
      );
    }
    await client.query('COMMIT');
    console.log(`[indexer] Exam ${exam_id}: ${chunks.length} chunks`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── Subject (patient/animal) indexer ─────────────────────────────────────────

async function indexSubject(subject_id, tenant_id) {
  const client = await pool.connect();
  try {
    // SELECT inside transaction so RLS applies correctly
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant_id]);
    const { rows } = await client.query(
      `SELECT s.*, o.name AS owner_name, o.phone AS owner_phone,
              o.email AS owner_email, o.cpf_last4 AS owner_cpf_last4
       FROM subjects s
       LEFT JOIN owners o ON o.id = s.owner_id AND o.tenant_id = $2
       WHERE s.id = $1 AND s.tenant_id = $2 AND s.deleted_at IS NULL`,
      [subject_id, tenant_id]
    );
    if (!rows.length) { await client.query('ROLLBACK'); return; }
    const s = rows[0];
    const isAnimal = s.subject_type === 'animal';
    const parts = [];

    if (isAnimal) {
      parts.push(`Animal: ${s.name}`);
      if (s.species) parts.push(`Espécie: ${SPECIES_LABELS[s.species] || s.species}`);
      if (s.breed)   parts.push(`Raça: ${s.breed}`);
      if (s.color)   parts.push(`Cor/Pelagem: ${s.color}`);
      if (s.neutered !== null && s.neutered !== undefined) parts.push(`Castrado: ${s.neutered ? 'Sim' : 'Não'}`);
      if (s.microchip) parts.push(`Microchip: ${s.microchip}`);
      if (s.owner_name) {
        parts.push(`Tutor/Dono: ${s.owner_name}`);
        if (s.owner_cpf_last4) parts.push(`CPF do tutor: ***${s.owner_cpf_last4}`);
        if (s.owner_phone)     parts.push(`Telefone do tutor: ${s.owner_phone}`);
        if (s.owner_email)     parts.push(`E-mail do tutor: ${s.owner_email}`);
      }
    } else {
      parts.push(`Paciente: ${s.name}`);
      if (s.blood_type)       parts.push(`Tipo sanguíneo: ${s.blood_type}`);
      if (s.height)           parts.push(`Altura: ${s.height}cm`);
      if (s.medications)      parts.push(`Medicamentos em uso: ${s.medications}`);
      if (s.smoking)          parts.push(`Tabagismo: ${s.smoking}`);
      if (s.alcohol)          parts.push(`Álcool: ${s.alcohol}`);
      if (s.diet_type)        parts.push(`Dieta: ${s.diet_type}`);
      if (s.physical_activity) parts.push(`Atividade física: ${s.physical_activity}`);
      if (s.family_history)   parts.push(`Histórico familiar: ${s.family_history}`);
    }

    const sexLabel = s.sex === 'M' ? (isAnimal ? 'Macho' : 'Masculino') : (isAnimal ? 'Fêmea' : 'Feminino');
    if (s.sex) parts.push(`Sexo: ${sexLabel}`);
    if (s.birth_date) {
      const ageYears = Math.floor((Date.now() - new Date(s.birth_date)) / (365.25 * 24 * 3600 * 1000));
      parts.push(`Data de nascimento: ${new Date(s.birth_date).toLocaleDateString('pt-BR')} (${ageYears} anos)`);
    }
    if (s.weight)        parts.push(`Peso: ${s.weight}kg`);
    if (s.allergies)     parts.push(`Alergias: ${s.allergies}`);
    if (s.comorbidities) parts.push(`Comorbidades: ${s.comorbidities}`);
    if (s.notes)         parts.push(`Observações: ${s.notes}`);
    parts.push(`Cadastrado em: ${new Date(s.created_at).toLocaleDateString('pt-BR')}`);

    const content      = parts.join(' | ');
    const source_label = `${isAnimal ? 'Animal' : 'Paciente'} · ${s.name}`;
    const [embedding]  = await embedBatch([content]);
    const vec          = `[${embedding.join(',')}]`;

    // Continue inside same open transaction
    await client.query(
      `DELETE FROM chat_embeddings WHERE subject_id = $1 AND chunk_type = 'patient_profile' AND tenant_id = $2`,
      [subject_id, tenant_id]
    );
    await client.query(
      `INSERT INTO chat_embeddings
         (tenant_id, subject_id, chunk_type, content, content_tsv, embedding, source_label)
       VALUES ($1,$2,'patient_profile',$3, to_tsvector('portuguese',$3), $4::vector,$5)`,
      [tenant_id, subject_id, content, vec, source_label]
    );
    await client.query('COMMIT');
    console.log(`[indexer] Subject ${subject_id} (${s.name}) indexed`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── Aggregate stats indexer ──────────────────────────────────────────────────

async function indexAggregates(tenant_id) {
  const client = await pool.connect();
  try {
    // Sequential queries on single client (pg doesn't support concurrent queries per client)
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant_id]);

    const statsRes = await client.query(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE subject_type = 'human')       AS humans,
        COUNT(*) FILTER (WHERE subject_type = 'animal')      AS animals,
        COUNT(*) FILTER (WHERE species = 'dog')              AS dogs,
        COUNT(*) FILTER (WHERE species = 'cat')              AS cats,
        COUNT(*) FILTER (WHERE species = 'equine')           AS equines,
        COUNT(*) FILTER (WHERE species = 'bovine')           AS bovines,
        COUNT(*) FILTER (WHERE species = 'bird')             AS birds,
        COUNT(*) FILTER (WHERE species = 'reptile')          AS reptiles,
        COUNT(*) FILTER (WHERE species = 'other')            AS others
      FROM subjects WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenant_id]);

    const creditRes = await client.query(`
      SELECT
        COALESCE(SUM(amount), 0) AS balance,
        COALESCE(SUM(CASE WHEN amount < 0 AND created_at >= NOW() - INTERVAL '30 days'
                          THEN ABS(amount) ELSE 0 END), 0) AS consumed_month,
        COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total_received
      FROM credit_ledger WHERE tenant_id = $1`, [tenant_id]);

    const patientsRes = await client.query(`
      SELECT id, name, subject_type, species, sex, birth_date, breed, allergies, comorbidities
      FROM subjects WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY name`, [tenant_id]);

    const ownersRes = await client.query(`
      SELECT o.name, o.phone, o.cpf_last4,
             STRING_AGG(s.name || ' (' || COALESCE(s.species,'?') || ')', ', ') AS animals
      FROM owners o
      LEFT JOIN subjects s ON s.owner_id = o.id AND s.tenant_id = $1 AND s.deleted_at IS NULL
      WHERE o.tenant_id = $1
      GROUP BY o.id, o.name, o.phone, o.cpf_last4
      ORDER BY o.name`, [tenant_id]);

    const st = statsRes.rows[0];
    const cr = creditRes.rows[0];
    const balance  = Number(cr.balance);
    const consumed = Number(cr.consumed_month);
    const received = Number(cr.total_received);

    const chunks = [];

    // ── Estatísticas gerais ──
    chunks.push({
      chunk_type: 'aggregate_stats',
      source_label: 'Estatísticas · Resumo do Sistema',
      content: [
        `Resumo do sistema GenomaFlow.`,
        `Total de cadastros: ${st.total} (${st.humans} pacientes humanos e ${st.animals} animais).`,
        `Animais por espécie: ${st.dogs} cães, ${st.cats} gatos, ${st.equines} equinos,`,
        `${st.bovines} bovinos, ${st.birds} aves, ${st.reptiles} répteis, ${st.others} outros.`,
      ].join(' ')
    });

    // ── Créditos ──
    chunks.push({
      chunk_type: 'aggregate_stats',
      source_label: 'Créditos · Saldo Atual',
      content: [
        `Créditos do sistema.`,
        `Saldo atual: ${balance.toFixed(2)} créditos disponíveis.`,
        `Consumo nos últimos 30 dias: ${consumed.toFixed(2)} créditos.`,
        `Total de créditos adquiridos: ${received.toFixed(2)}.`,
        balance === 0 ? 'ATENÇÃO: saldo zerado. Recarregue para continuar.' :
        balance < 5  ? `ATENÇÃO: saldo baixo (${balance.toFixed(2)} créditos).` : '',
        `Cada pergunta ao assistente custa 0,25 crédito. Cada agente de exame custa 1 crédito.`,
        `Com o saldo atual é possível fazer aproximadamente ${Math.floor(balance / 0.25)} perguntas ao assistente.`,
      ].filter(Boolean).join(' ')
    });

    // ── Lista de pacientes ──
    if (patientsRes.rows.length > 0) {
      const listLines = patientsRes.rows.map(p => {
        const tipo = p.subject_type === 'human' ? 'Humano' : (SPECIES_LABELS[p.species] || p.species);
        const raça = p.breed ? `, ${p.breed}` : '';
        const idade = p.birth_date
          ? `, ${Math.floor((Date.now() - new Date(p.birth_date)) / (365.25*24*3600*1000))} anos`
          : '';
        const alg = p.allergies ? `, Alergias: ${p.allergies}` : '';
        const comorb = p.comorbidities ? `, Comorbidades: ${p.comorbidities}` : '';
        return `${p.name} (${tipo}${raça}${idade}${alg}${comorb})`;
      });
      // Split into chunks of 50 patients each to avoid huge embeddings
      for (let i = 0; i < listLines.length; i += 50) {
        const slice = listLines.slice(i, i + 50);
        chunks.push({
          chunk_type: 'aggregate_stats',
          source_label: `Lista · Pacientes ${i+1}–${Math.min(i+50, listLines.length)}`,
          content: `Lista de pacientes cadastrados (${i+1} a ${Math.min(i+50, listLines.length)} de ${listLines.length}): ${slice.join('; ')}.`
        });
      }
    }

    // ── Donos/Tutores ──
    if (ownersRes.rows.length > 0) {
      const ownerLines = ownersRes.rows.map(o =>
        `${o.name}${o.cpf_last4 ? ` (CPF ***${o.cpf_last4})` : ''}${o.phone ? `, Tel: ${o.phone}` : ''}${o.animals ? ` — Animais: ${o.animals}` : ''}`
      );
      for (let i = 0; i < ownerLines.length; i += 50) {
        chunks.push({
          chunk_type: 'aggregate_stats',
          source_label: `Lista · Tutores/Donos`,
          content: `Tutores cadastrados: ${ownerLines.slice(i, i+50).join('; ')}.`
        });
      }
    }

    if (chunks.length === 0) { await client.query('ROLLBACK'); return; }
    const embeddings = await embedBatch(chunks.map(c => c.content));

    await client.query(
      `DELETE FROM chat_embeddings WHERE chunk_type = 'aggregate_stats' AND tenant_id = $1`,
      [tenant_id]
    );
    for (let i = 0; i < chunks.length; i++) {
      const c   = chunks[i];
      const vec = `[${embeddings[i].join(',')}]`;
      await client.query(
        `INSERT INTO chat_embeddings
           (tenant_id, chunk_type, content, content_tsv, embedding, source_label)
         VALUES ($1,$2,$3, to_tsvector('portuguese',$3), $4::vector,$5)`,
        [tenant_id, c.chunk_type, c.content, vec, c.source_label]
      );
    }
    await client.query('COMMIT');
    console.log(`[indexer] Aggregates for tenant ${tenant_id}: ${chunks.length} chunks`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { indexExam, indexSubject, indexAggregates };
