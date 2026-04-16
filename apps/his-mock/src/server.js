'use strict';

const fastify = require('fastify')({ logger: false });

// ---------------------------------------------------------------------------
// Dados de exemplo — simula banco do HIS "Clínica São Lucas"
// ---------------------------------------------------------------------------

const PACIENTES = [
  {
    id_paciente: 'PAC-001',
    nome_completo: 'João da Silva',
    data_nascimento: '1975-03-15',
    sexo: 'M',
    cpf: '123.456.789-00',
    telefone: '(11) 99999-0001',
    convenio: 'Unimed'
  },
  {
    id_paciente: 'PAC-002',
    nome_completo: 'Maria Santos',
    data_nascimento: '1988-07-22',
    sexo: 'F',
    cpf: '987.654.321-00',
    telefone: '(11) 98888-0002',
    convenio: 'SulAmérica'
  },
  {
    id_paciente: 'PAC-003',
    nome_completo: 'Carlos Oliveira',
    data_nascimento: '1962-11-08',
    sexo: 'M',
    cpf: '111.222.333-44',
    telefone: '(11) 97777-0003',
    convenio: 'Particular'
  },
  {
    id_paciente: 'PAC-004',
    nome_completo: 'Ana Paula Ferreira',
    data_nascimento: '1994-05-30',
    sexo: 'F',
    cpf: '555.666.777-88',
    telefone: '(11) 96666-0004',
    convenio: 'Bradesco Saúde'
  }
];

const RESULTADOS = [
  {
    id_externo: 'RES-2024-0001',
    id_paciente: 'PAC-001',
    nome_paciente: 'João da Silva',
    data_nascimento_paciente: '1975-03-15',
    sexo_paciente: 'M',
    tipo_exame: 'Genoma Completo (WGS)',
    data_coleta: '2024-11-10',
    data_resultado: '2024-11-25',
    status: 'concluido',
    url_laudo_pdf: 'https://pdfobject.com/pdf/sample.pdf',
    laboratorio: 'Lab GenSeq',
    medico_solicitante: 'Dr. Fernando Costa',
    observacoes: 'Variante BRCA1 detectada — risco aumentado para câncer de mama'
  },
  {
    id_externo: 'RES-2024-0002',
    id_paciente: 'PAC-002',
    nome_paciente: 'Maria Santos',
    data_nascimento_paciente: '1988-07-22',
    sexo_paciente: 'F',
    tipo_exame: 'Painel Oncológico 500 genes',
    data_coleta: '2024-12-01',
    data_resultado: '2024-12-15',
    status: 'concluido',
    url_laudo_pdf: 'https://pdfobject.com/pdf/sample.pdf',
    laboratorio: 'Lab GenSeq',
    medico_solicitante: 'Dra. Camila Rocha',
    observacoes: 'Sem alterações clinicamente significativas identificadas'
  },
  {
    id_externo: 'RES-2024-0003',
    id_paciente: 'PAC-003',
    nome_paciente: 'Carlos Oliveira',
    data_nascimento_paciente: '1962-11-08',
    sexo_paciente: 'M',
    tipo_exame: 'Farmacogenômica',
    data_coleta: '2024-12-10',
    data_resultado: '2024-12-20',
    status: 'concluido',
    url_laudo_pdf: 'https://pdfobject.com/pdf/sample.pdf',
    laboratorio: 'Lab GenSeq',
    medico_solicitante: 'Dr. Fernando Costa',
    observacoes: 'Metabolizador lento CYP2C19 — ajuste de dose de clopidogrel recomendado'
  },
  {
    id_externo: 'RES-2025-0001',
    id_paciente: 'PAC-004',
    nome_paciente: 'Ana Paula Ferreira',
    data_nascimento_paciente: '1994-05-30',
    sexo_paciente: 'F',
    tipo_exame: 'Exoma Clínico',
    data_coleta: '2025-01-05',
    data_resultado: null,
    status: 'processando',
    url_laudo_pdf: null,
    laboratorio: 'Lab GenSeq',
    medico_solicitante: 'Dra. Camila Rocha',
    observacoes: null
  }
];

// ---------------------------------------------------------------------------
// Schemas reutilizáveis
// ---------------------------------------------------------------------------

const S_PACIENTE = {
  $id: 'Paciente',
  type: 'object',
  properties: {
    id_paciente:     { type: 'string' },
    nome_completo:   { type: 'string' },
    data_nascimento: { type: 'string' },
    sexo:            { type: 'string' },
    cpf:             { type: 'string' },
    telefone:        { type: 'string' },
    convenio:        { type: 'string' }
  }
};

const S_RESULTADO = {
  $id: 'Resultado',
  type: 'object',
  properties: {
    id_externo:               { type: 'string' },
    id_paciente:              { type: 'string' },
    nome_paciente:            { type: 'string' },
    data_nascimento_paciente: { type: 'string' },
    sexo_paciente:            { type: 'string' },
    tipo_exame:               { type: 'string' },
    data_coleta:              { type: 'string' },
    data_resultado:           { type: ['string', 'null'] },
    status:                   { type: 'string' },
    url_laudo_pdf:            { type: ['string', 'null'] },
    laboratorio:              { type: 'string' },
    medico_solicitante:       { type: 'string' },
    observacoes:              { type: ['string', 'null'] }
  }
};

const S_WEBHOOK = {
  $id: 'WebhookPayload',
  type: 'object',
  properties: {
    id_externo:               { type: 'string' },
    nome_paciente:            { type: 'string' },
    data_nascimento_paciente: { type: 'string' },
    sexo_paciente:            { type: 'string' },
    url_laudo_pdf:            { type: ['string', 'null'] },
    data_resultado:           { type: ['string', 'null'] },
    tipo_exame:               { type: 'string' }
  }
};

fastify.addSchema(S_PACIENTE);
fastify.addSchema(S_RESULTADO);
fastify.addSchema(S_WEBHOOK);

// ---------------------------------------------------------------------------
// Basic Auth
// ---------------------------------------------------------------------------

const HIS_USER = process.env.HIS_USER || 'his-admin';
const HIS_PASS = process.env.HIS_PASS || 'his@2024';

function checkAuth(request, reply) {
  const authHeader = request.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    reply.header('WWW-Authenticate', 'Basic realm="HIS Clínica São Lucas"');
    reply.status(401).send({ error: 'Autenticação necessária' });
    return false;
  }
  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  const colonIdx = decoded.indexOf(':');
  const user = decoded.slice(0, colonIdx);
  const pass = decoded.slice(colonIdx + 1);
  if (user !== HIS_USER || pass !== HIS_PASS) {
    reply.header('WWW-Authenticate', 'Basic realm="HIS Clínica São Lucas"');
    reply.status(401).send({ error: 'Credenciais inválidas' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Swagger / OpenAPI
// ---------------------------------------------------------------------------

fastify.register(require('@fastify/swagger'), {
  openapi: {
    openapi: '3.0.3',
    info: {
      title: 'HIS Clínica São Lucas — API de Integração',
      description:
        'API REST do Sistema de Informação Hospitalar (HIS) da Clínica São Lucas.\n\n' +
        '**Autenticação:** Basic Auth — usuário: `his-admin` / senha: `his@2024`\n\n' +
        'Expõe dados de pacientes e resultados de exames genômicos para integração com o GenomaFlow.',
      version: '1.0.0'
    },
    servers: [
      { url: 'http://his-mock:3001', description: 'Docker interno' },
      { url: 'http://localhost:3002', description: 'Acesso externo (porta mapeada)' }
    ],
    components: {
      securitySchemes: {
        basicAuth: { type: 'http', scheme: 'basic' }
      }
    },
    security: [{ basicAuth: [] }]
  }
});

fastify.register(require('@fastify/swagger-ui'), {
  routePrefix: '/swagger',
  uiConfig: { docExpansion: 'list', persistAuthorization: true }
});

// ---------------------------------------------------------------------------
// Rotas — registradas dentro de fastify.register para @fastify/swagger capturar
// ---------------------------------------------------------------------------

fastify.get('/health', { schema: { hide: true } }, async () => ({
  status: 'ok', sistema: 'HIS Clínica São Lucas', versao: '1.0.0'
}));

fastify.register(async function routes(f) {
  f.get('/pacientes', {
    schema: {
      summary: 'Listar pacientes',
      description: 'Retorna todos os pacientes cadastrados no HIS.',
      tags: ['Pacientes'],
      response: { 200: { type: 'array', items: { $ref: 'Paciente#' } } }
    }
  }, async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    return PACIENTES;
  });

  f.get('/pacientes/:id', {
    schema: {
      summary: 'Buscar paciente',
      tags: ['Pacientes'],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: { 200: { $ref: 'Paciente#' } }
    }
  }, async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const p = PACIENTES.find(x => x.id_paciente === request.params.id);
    if (!p) return reply.status(404).send({ error: 'Paciente não encontrado' });
    return p;
  });

  f.get('/resultados', {
    schema: {
      summary: 'Listar resultados de exames',
      description:
        'Retorna todos os resultados de exames genômicos. ' +
        'Inclui dados do paciente (`nome_paciente`, `data_nascimento_paciente`, `sexo_paciente`) ' +
        'e URL do laudo PDF (`url_laudo_pdf`) — campos usados pelo GenomaFlow na integração.',
      tags: ['Resultados'],
      querystring: {
        type: 'object',
        properties: {
          status:      { type: 'string', description: 'Filtrar por status (processando | concluido | cancelado)' },
          id_paciente: { type: 'string', description: 'Filtrar por ID do paciente' }
        }
      },
      response: { 200: { type: 'array', items: { $ref: 'Resultado#' } } }
    }
  }, async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    let data = RESULTADOS;
    if (request.query.status)      data = data.filter(r => r.status === request.query.status);
    if (request.query.id_paciente) data = data.filter(r => r.id_paciente === request.query.id_paciente);
    return data;
  });

  f.get('/resultados/:id', {
    schema: {
      summary: 'Buscar resultado por ID externo',
      tags: ['Resultados'],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: { 200: { $ref: 'Resultado#' } }
    }
  }, async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const r = RESULTADOS.find(x => x.id_externo === request.params.id);
    if (!r) return reply.status(404).send({ error: 'Resultado não encontrado' });
    return r;
  });

  f.post('/resultados/:id/enviar-genomaflow', {
    schema: {
      summary: 'Simular envio de resultado ao GenomaFlow',
      description:
        'Retorna o payload que seria enviado via webhook ao GenomaFlow quando um laudo fica pronto. ' +
        'Use para testar o mapeamento de campos no Integration Studio.',
      tags: ['Integração GenomaFlow'],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            mensagem:        { type: 'string' },
            payload_enviado: { $ref: 'WebhookPayload#' }
          }
        }
      }
    }
  }, async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const r = RESULTADOS.find(x => x.id_externo === request.params.id);
    if (!r) return reply.status(404).send({ error: 'Resultado não encontrado' });
    return {
      mensagem: 'Payload que seria enviado ao webhook do GenomaFlow',
      payload_enviado: {
        id_externo:               r.id_externo,
        nome_paciente:            r.nome_paciente,
        data_nascimento_paciente: r.data_nascimento_paciente,
        sexo_paciente:            r.sexo_paciente,
        url_laudo_pdf:            r.url_laudo_pdf,
        data_resultado:           r.data_resultado,
        tipo_exame:               r.tipo_exame
      }
    };
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

fastify.listen({ port: 3001, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log('HIS Mock — Clínica São Lucas rodando em http://0.0.0.0:3001');
  console.log('Swagger UI: http://localhost:3002/swagger');
  console.log('Credenciais: his-admin / his@2024');
});
