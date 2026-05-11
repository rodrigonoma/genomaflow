'use strict';

// Bloqueia rotas /aesthetic/* pra módulos human/veterinary.
// Master é exceção (acesso a tudo).

async function requireEsteticaModule(request, reply) {
  if (request.user?.role === 'master') return;
  if (request.user?.module !== 'estetica') {
    return reply.status(403).send({
      error: 'Funcionalidade disponível apenas para clínicas com módulo estetica',
    });
  }
}

module.exports = { requireEsteticaModule };
