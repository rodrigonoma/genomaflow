'use strict';
/**
 * Tools de Pacientes/Animais para o Copilot.
 * V1 enxuto: listar, ver detalhes, cadastrar. Update/delete em V2.
 *
 * Mesmo padrão de defesa em profundidade do agenda-chat-tools:
 *  - tenant_id/user_id/module SEMPRE do context (JWT verificado), nunca do input
 *  - withTenant em escritas
 *  - publishSubjectUpserted dispara WS pra frontend refrescar tela de pacientes
 */

const { withTenant } = require('../db/tenant');
const crypto = require('crypto');

const VALID_SEX_HUMAN = ['M', 'F', 'other'];
const VALID_SEX_ANIMAL = ['M', 'F', 'other'];
const VALID_SPECIES = ['dog', 'cat', 'equine', 'bovine', 'bird', 'reptile', 'other'];
const VALID_BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function hashCpf(cpf) {
  return crypto.createHash('sha256').update(String(cpf).replace(/\D/g, '')).digest('hex');
}

function cpfLast4(cpf) {
  const digits = String(cpf).replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function isValidISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

// ── Tool definitions ────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'list_patients',
    description:
      'Lista pacientes/animais cadastrados na clínica do usuário. Retorna contagem total e ' +
      'lista resumida dos primeiros N. Use quando o usuário perguntar quantos tem cadastrados ' +
      'ou quiser ver a lista geral.',
    input_schema: {
      type: 'object',
      properties: {
        filter_name: {
          type: 'string',
          description: 'Substring opcional pra filtrar por nome (case-insensitive). Vazio = lista todos.',
        },
        limit: {
          type: 'integer',
          description: 'Máximo de resultados (default 10, max 50). Total sempre vem.',
        },
      },
    },
  },
  {
    name: 'find_patient_full_details',
    description:
      'Retorna detalhes completos de um paciente/animal (campos clínicos, contato, owner). ' +
      'Use quando o usuário quer ver tudo sobre um paciente específico.',
    input_schema: {
      type: 'object',
      properties: {
        patient_id: { type: 'string', description: 'UUID do paciente/animal' },
      },
      required: ['patient_id'],
    },
  },
  {
    name: 'create_patient',
    description:
      'Cadastra novo paciente (módulo humano) ou animal (módulo veterinário). REGRAS:\n' +
      '- Antes de chamar, colete TODOS os campos obrigatórios via diálogo natural com o usuário.\n' +
      '- Apresente um resumo dos dados ANTES de chamar e peça confirmação.\n' +
      '- Só execute esta tool após o usuário confirmar.\n' +
      'Obrigatórios humano: name, birth_date (YYYY-MM-DD), sex.\n' +
      'Obrigatórios veterinário: name, sex, species.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome completo' },
        birth_date: { type: 'string', description: 'Data de nascimento YYYY-MM-DD (humano: obrigatório; vet: opcional)' },
        sex: { type: 'string', enum: ['M', 'F', 'other'] },
        cpf: { type: 'string', description: 'CPF do humano (opcional, qualquer formato)' },
        phone: { type: 'string', description: 'Telefone (opcional)' },
        notes: { type: 'string', description: 'Observações livres (opcional)' },
        // veterinário
        species: { type: 'string', enum: VALID_SPECIES, description: 'Apenas vet — espécie do animal' },
        breed: { type: 'string', description: 'Raça (vet, opcional)' },
        microchip: { type: 'string', description: 'Microchip (vet, opcional)' },
        neutered: { type: 'boolean', description: 'Castrado (vet, opcional)' },
      },
      required: ['name', 'sex'],
    },
  },
];

// ── Executors ───────────────────────────────────────────────────────

async function execListPatients(input, ctx) {
  const i = input || {};
  const limit = Math.min(50, Math.max(1, Number.isInteger(i.limit) ? i.limit : 10));
  const filterName = (i.filter_name || '').trim();

  const params = [ctx.tenant_id];
  let whereExtra = '';
  if (filterName.length >= 1) {
    params.push(`%${filterName}%`);
    whereExtra = ` AND name ILIKE $${params.length}`;
  }

  // Count total + sample
  const { rows: countRows } = await ctx.fastify.pg.query(
    `SELECT COUNT(*)::int AS n FROM subjects
     WHERE tenant_id = $1 AND deleted_at IS NULL${whereExtra}`,
    params
  );
  const total = countRows[0].n;

  const { rows } = await ctx.fastify.pg.query(
    `SELECT id, name, subject_type, sex, birth_date, species, breed, created_at
     FROM subjects
     WHERE tenant_id = $1 AND deleted_at IS NULL${whereExtra}
     ORDER BY name ASC
     LIMIT ${limit}`,
    params
  );

  return {
    total,
    showing: rows.length,
    filter_name: filterName || null,
    module: ctx.module,
    patients: rows.map(r => ({
      id: r.id,
      name: r.name,
      subject_type: r.subject_type,
      sex: r.sex,
      birth_date: r.birth_date,
      species: r.species || undefined,
      breed: r.breed || undefined,
    })),
  };
}

async function execFindPatientFullDetails(input, ctx) {
  if (!input?.patient_id) return { error: 'patient_id obrigatório' };
  const { rows } = await ctx.fastify.pg.query(
    `SELECT s.id, s.name, s.subject_type, s.sex, s.birth_date, s.cpf_last4, s.phone,
            s.weight, s.height, s.blood_type, s.allergies, s.comorbidities,
            s.medications, s.smoking, s.alcohol, s.diet_type, s.physical_activity, s.family_history,
            s.notes, s.species, s.breed, s.color, s.microchip, s.neutered,
            s.consent_given_at, s.created_at,
            o.name AS owner_name, o.phone AS owner_phone
     FROM subjects s
     LEFT JOIN owners o ON o.id = s.owner_id AND o.tenant_id = $1
     WHERE s.id = $2 AND s.tenant_id = $1 AND s.deleted_at IS NULL`,
    [ctx.tenant_id, input.patient_id]
  );
  if (rows.length === 0) return { error: 'not_found', message: 'Paciente não encontrado.' };
  const r = rows[0];
  // Remove campos null pra o LLM ver só o que existe (response mais limpa)
  const out = { id: r.id };
  for (const [k, v] of Object.entries(r)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

async function execCreatePatient(input, ctx) {
  const i = input || {};
  const userModule = ctx.module || 'human';

  // Validações comuns
  if (!i.name || typeof i.name !== 'string' || i.name.trim().length < 2) {
    return { error: 'name obrigatório (mínimo 2 chars)' };
  }
  if (!VALID_SEX_HUMAN.includes(i.sex)) {
    return { error: `sex deve ser um de ${VALID_SEX_HUMAN.join(', ')}` };
  }

  // Específicas do módulo
  if (userModule === 'human') {
    if (!isValidISODate(i.birth_date)) {
      return { error: 'birth_date obrigatório no formato YYYY-MM-DD pra humano' };
    }
    if (i.species) {
      return { error: 'species só pra módulo veterinário (não passar pra humano)' };
    }
  } else if (userModule === 'veterinary') {
    if (!i.species || !VALID_SPECIES.includes(i.species)) {
      return { error: `species obrigatório (${VALID_SPECIES.join(', ')}) pra veterinário` };
    }
    if (i.birth_date && !isValidISODate(i.birth_date)) {
      return { error: 'birth_date inválido (use YYYY-MM-DD ou omita)' };
    }
  } else {
    return { error: 'módulo desconhecido — não é possível cadastrar' };
  }

  // Verifica duplicata por nome no mesmo tenant (heurística simples)
  const { rows: dupRows } = await ctx.fastify.pg.query(
    `SELECT id, name FROM subjects
     WHERE tenant_id = $1 AND deleted_at IS NULL AND name ILIKE $2
     LIMIT 3`,
    [ctx.tenant_id, i.name.trim()]
  );
  if (dupRows.length > 0) {
    return {
      error: 'duplicate_name',
      message: 'Já existe paciente com este nome. Confirme se é cadastro novo ou se quer ver o existente.',
      existing: dupRows.map(d => ({ id: d.id, name: d.name })),
    };
  }

  const cpfH = i.cpf ? hashCpf(i.cpf) : null;
  const cpfL = i.cpf ? cpfLast4(i.cpf) : null;

  const subject = await withTenant(ctx.fastify.pg, ctx.tenant_id, async (client) => {
    if (userModule === 'human') {
      const { rows } = await client.query(
        `INSERT INTO subjects
           (tenant_id, name, birth_date, sex, cpf_hash, cpf_last4, phone, notes, subject_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'human')
         RETURNING id, name, birth_date, sex, subject_type, phone, created_at`,
        [ctx.tenant_id, i.name.trim(), i.birth_date, i.sex,
         cpfH, cpfL, i.phone || null, i.notes || null]
      );
      return rows[0];
    }
    // veterinary
    const { rows } = await client.query(
      `INSERT INTO subjects
         (tenant_id, name, birth_date, sex, species, breed, microchip, neutered,
          notes, subject_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'animal')
       RETURNING id, name, birth_date, sex, species, breed, microchip, neutered,
                 subject_type, created_at`,
      [ctx.tenant_id, i.name.trim(), i.birth_date || null, i.sex,
       i.species, i.breed || null, i.microchip || null,
       typeof i.neutered === 'boolean' ? i.neutered : null, i.notes || null]
    );
    return rows[0];
  });

  // WS pub/sub pra refrescar lista no frontend (mesmo canal usado por
  // patients.js POST /, escutado pelo worker de RAG e pelo nosso WS)
  try {
    if (ctx.fastify.redis) {
      await ctx.fastify.redis.publish(
        `subject:upserted:${ctx.tenant_id}`,
        JSON.stringify({ subject_id: subject.id })
      );
    }
  } catch (_) {}

  return {
    id: subject.id,
    name: subject.name,
    subject_type: subject.subject_type,
    sex: subject.sex,
    birth_date: subject.birth_date || undefined,
    species: subject.species || undefined,
    breed: subject.breed || undefined,
  };
}

const EXECUTORS = {
  list_patients: execListPatients,
  find_patient_full_details: execFindPatientFullDetails,
  create_patient: execCreatePatient,
};

async function executeTool(name, input, context) {
  const exec = EXECUTORS[name];
  if (!exec) {
    return { error: `Tool desconhecida: ${name}`, latency_ms: 0 };
  }
  const startedAt = Date.now();
  try {
    const result = await exec(input || {}, context);
    return { result, latency_ms: Date.now() - startedAt };
  } catch (err) {
    if (context.log?.error) {
      context.log.error({ err, tool: name, input }, 'patient-chat-tools: executor error');
    }
    return { error: err.message || 'Erro interno', latency_ms: Date.now() - startedAt };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  EXECUTORS,
  executeTool,
  VALID_SPECIES,
};
