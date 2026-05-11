'use strict';

/**
 * IDs de modelos Anthropic agrupados por papel funcional.
 * Mesma estrutura do worker (apps/worker/src/config/models.js) — sincronizar
 * envs em ambos quando trocar defaults.
 *
 * Para usar:
 *   const MODELS = require('../config/models');
 *   client.messages.create({ model: MODELS.UTILITY, ... });
 */

module.exports = {
  // Premium clínico — IA pró-ativa em patient-detail, co-piloto durante consulta
  CLINICAL_PREMIUM: process.env.MODEL_CLINICAL_PREMIUM || 'claude-opus-4-7',

  // Visão / raciocínio mid-tier — chat answer (resposta final ao usuário)
  VISION: process.env.MODEL_VISION || 'claude-sonnet-4-6',

  // Utilitário cheap — PII redact (imagem + PDF), chat search rerank,
  // copilot de ajuda, mensagens validation
  UTILITY: process.env.MODEL_UTILITY || 'claude-haiku-4-5-20251001',
};
