'use strict';

/**
 * Middleware que bloqueia rotas onde só medico/dentista podem agir.
 * Usado em prescriptions.js (POST/PUT/PATCH).
 *
 * Esteticista (estetica module) NÃO pode prescrever — gate aplicado aqui.
 * Biomedico, outro: também bloqueados (V1).
 *
 * Aplicar em rotas DEPOIS de fastify.authenticate (precisa de request.user populado).
 */
async function requireMedico(request, reply) {
  const ptype = request.user?.professional_type;
  if (ptype !== 'medico' && ptype !== 'dentista') {
    return reply.status(403).send({
      error: 'Apenas profissional médico ou dentista pode realizar esta ação.',
    });
  }
}

module.exports = { requireMedico };
