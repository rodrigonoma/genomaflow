'use strict';

/**
 * IDs de modelos Anthropic agrupados por papel funcional.
 *
 * Cada categoria pode ser overrideada por env var em produção sem novo deploy
 * de código. Defaults preservam o comportamento atual (sem env = igual antes).
 *
 * Operacionalmente útil pra:
 * - Experimentar Haiku 4.5 em agentes baratos antes de adotar global
 * - Subir agentes premium pra Opus 4.7 quando sair versão nova
 * - Rollback rápido se um modelo novo regredir qualidade clínica
 *
 * Para usar:
 *   const MODELS = require('../config/models');
 *   client.messages.create({ model: MODELS.CLINICAL_AGENT, ... });
 */

module.exports = {
  // Agentes clínicos de texto (hematology, cardiovascular, metabolic, therapeutic,
  // nutrition, clinical_correlation, small_animals, equine, bovine).
  // + log do model_used em processors/exam.js fase 1
  CLINICAL_AGENT: process.env.MODEL_CLINICAL_AGENT || 'claude-opus-4-6',

  // Premium clínico — features que exigem raciocínio mais profundo
  // (transcrição vídeo Claude summary, IA pró-ativa, co-piloto consulta)
  CLINICAL_PREMIUM: process.env.MODEL_CLINICAL_PREMIUM || 'claude-opus-4-7',

  // Visão / imagem — agentes de imagem médica (RX, MRI, US, ECG), classificador
  // DICOM/JPG, OCR de foto de laudo impresso (image.js)
  // + log do model_used em processors/exam.js fase 2 imaging
  VISION: process.env.MODEL_VISION || 'claude-sonnet-4-6',

  // Utilitário cheap — OCR de PDF escaneado, PII redact (image + PDF), chat
  // search rerank, copilot de ajuda. Haiku é 10-20x mais barato que Sonnet.
  UTILITY: process.env.MODEL_UTILITY || 'claude-haiku-4-5-20251001',
};
