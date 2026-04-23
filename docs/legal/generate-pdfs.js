/**
 * Gera os 5 PDFs legais em apps/web/public/legal/.
 * Uso: docker compose exec worker node /app/../docs/legal/generate-pdfs.js
 *   (ou rodar via script wrapper — ver README)
 *
 * Este arquivo é DEV-ONLY e NÃO vai para produção. Os PDFs gerados são
 * commitados no repo e servidos pelo frontend.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.OUT_DIR || '/app/legal-out';
fs.mkdirSync(OUT_DIR, { recursive: true });

const COMPANY = {
  razao: 'RODRIGO TAVARES NOMA TECNOLOGIA DA INFORMACAO LTDA',
  cnpj: '64.052.716/0001-15',
  city: 'São Paulo/SP',
};
const VERSION = '1.1';

// ───── helpers ─────
function newDoc(title) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, left: 64, right: 64, bottom: 64 },
    info: { Title: title, Author: 'GenomaFlow', Subject: title },
  });
  return doc;
}

function header(doc, title, subtitle) {
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#1b1b64').text(title, { align: 'center' });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10).fillColor('#6e6d80').text(`GenomaFlow · Versão ${VERSION}`, { align: 'center' });
  if (subtitle) {
    doc.moveDown(0.1);
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6e6d80').text(subtitle, { align: 'center' });
  }
  doc.moveDown(0.6);
  doc.strokeColor('#c0c1ff').lineWidth(0.8).moveTo(64, doc.y).lineTo(531, doc.y).stroke();
  doc.moveDown(1);
  doc.fillColor('#111111');
}

function section(doc, num, title) {
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1b1b64').text(`${num}. ${title.toUpperCase()}`);
  doc.moveDown(0.2);
  doc.fillColor('#111111');
}

function p(doc, text) {
  doc.font('Helvetica').fontSize(10).fillColor('#222').text(text, { align: 'justify', paragraphGap: 3, lineGap: 1.5 });
}

function bullet(doc, text) {
  doc.font('Helvetica').fontSize(10).fillColor('#222').text(`• ${text}`, { indent: 10, paragraphGap: 2, lineGap: 1.5 });
}

function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(7).fillColor('#8c8ca0')
      .text(
        `${COMPANY.razao} · CNPJ ${COMPANY.cnpj} · ${COMPANY.city}  ·  pág. ${i + 1}/${range.count}`,
        64, 800, { align: 'center', width: 467, lineBreak: false }
      );
  }
}

function save(doc, filename) {
  const out = path.join(OUT_DIR, filename);
  return new Promise((resolve) => {
    const stream = fs.createWriteStream(out);
    doc.pipe(stream);
    doc.end();
    stream.on('finish', () => { console.log(`✓ ${filename}`); resolve(); });
  });
}

// ───── 1. Contrato SaaS ─────
async function contratoSaas() {
  const doc = newDoc('Contrato SaaS — GenomaFlow');
  header(doc, 'Contrato SaaS — GenomaFlow', 'Termos de contratação e responsabilidade clínica');

  section(doc, 1, 'Identificação das Partes');
  p(doc, `CONTRATADA: ${COMPANY.razao}, inscrita no CNPJ sob nº ${COMPANY.cnpj}, com sede em ${COMPANY.city}, doravante denominada "GenomaFlow".`);
  p(doc, 'CONTRATANTE: Pessoa jurídica ou profissional liberal da saúde, regularmente cadastrado na plataforma, doravante denominada "Clínica" ou "Usuário".');

  section(doc, 2, 'Objeto');
  p(doc, 'O presente contrato tem por objeto o licenciamento de uso, em modelo Software as a Service (SaaS), da plataforma GenomaFlow, ferramenta de Suporte à Decisão Clínica assistida por Inteligência Artificial, destinada a auxiliar profissionais de saúde habilitados na interpretação de exames e imagens médicas.');
  p(doc, 'A plataforma NÃO realiza diagnóstico, prescrição autônoma nem substitui avaliação clínica presencial.');

  section(doc, 3, 'Licença de Uso');
  p(doc, 'A GenomaFlow concede à Contratante licença não exclusiva, intransferível, revogável e limitada para acessar e utilizar a plataforma, estritamente para as finalidades previstas, durante a vigência contratual.');
  bullet(doc, 'A licença não transfere propriedade intelectual sobre código, modelos de IA ou bases de dados.');
  bullet(doc, 'Credenciais de acesso são pessoais e intransferíveis — é vedado o compartilhamento de login.');

  section(doc, 4, 'Responsabilidades da Contratante');
  bullet(doc, 'Utilizar a plataforma em conformidade com a legislação aplicável (LGPD, Marco Civil, Código de Ética Profissional, resoluções do CFM e CFMV).');
  bullet(doc, 'Validar manualmente todo resultado gerado pela IA antes de aplicação clínica.');
  bullet(doc, 'Obter consentimento livre e informado do paciente/responsável para tratamento de dados sensíveis (LGPD Art 11).');
  bullet(doc, 'Manter atualizados os dados cadastrais, inclusive comprovação de habilitação profissional ativa (CRM/CRMV).');
  bullet(doc, 'Arcar com o pagamento das contraprestações e créditos consumidos conforme plano contratado.');

  section(doc, 5, 'Responsabilidade Clínica (cláusula de proteção mútua)');
  p(doc, 'A Contratante reconhece expressamente que:');
  bullet(doc, 'A plataforma é ferramenta de apoio, cujos outputs são sugestões algorítmicas passíveis de erro, falso-positivos e falso-negativos.');
  bullet(doc, 'Toda decisão clínica — diagnóstico, conduta, prescrição, laudo, alta — é de responsabilidade pessoal, profissional e integral do profissional habilitado (CRM/CRMV) que a subscreve.');
  bullet(doc, 'A IA não detecta 100% dos achados de um exame, nem elimina a possibilidade de achados falsamente sinalizados.');
  bullet(doc, 'A qualidade do resultado depende da qualidade dos dados de entrada (imagens nítidas, laudos legíveis, dados clínicos estruturados).');
  bullet(doc, 'A plataforma não considera contexto clínico fora dos dados inseridos — integrar o quadro clínico completo é prerrogativa e dever do profissional.');

  section(doc, 6, 'SLA — Disponibilidade, Suporte e Escopo');
  p(doc, 'Disponibilidade da plataforma: meta de 99,5% de uptime medido mensalmente, excluídas janelas programadas de manutenção e indisponibilidades decorrentes de terceiros, força maior ou ataques externos fora do controle razoável.');
  p(doc, 'Suporte a incidentes:');
  bullet(doc, 'Primeiro contato em incidente com operação parada: até 24 (vinte e quatro) horas corridas a partir da abertura do chamado.');
  bullet(doc, 'Resolução de bug crítico com operação parada: até 48 (quarenta e oito) horas úteis a partir da confirmação do incidente.');
  bullet(doc, 'Solicitações de melhoria, novas funcionalidades e ajustes que não envolvam operação parada: sem SLA — priorizadas no roadmap do produto a critério da Contratada.');
  p(doc, 'Escopo fora do SLA:');
  bullet(doc, 'Treinamento de uso da plataforma não está incluído no contrato. Materiais de suporte (documentação, vídeos e base de ajuda) são disponibilizados quando existentes.');
  bullet(doc, 'Customizações, integrações sob medida e consultoria são contratadas separadamente.');

  section(doc, 7, 'Proteção de Dados (LGPD)');
  bullet(doc, 'Clínica = Controladora dos dados dos pacientes.');
  bullet(doc, 'GenomaFlow = Operadora, nos termos do Art 5º, VII da LGPD.');
  bullet(doc, 'Detalhamento das obrigações do operador está no DPA (Data Processing Agreement) anexo.');
  bullet(doc, 'A política de privacidade detalha finalidades, bases legais, compartilhamentos e direitos do titular.');

  section(doc, 8, 'Limitação de Responsabilidade');
  p(doc, 'A GenomaFlow não responde por decisões clínicas, divergências entre resultado da IA e desfechos reais, danos causados pela ausência de validação profissional, uso em desacordo com este instrumento, perdas indiretas ou lucros cessantes, ressalvadas hipóteses de dolo ou culpa grave comprovada.');
  p(doc, 'Em qualquer hipótese, a indenização fica limitada ao valor pago pela Contratante nos 12 meses anteriores ao evento.');

  section(doc, 9, 'Vigência, Modificação e Rescisão');
  bullet(doc, 'Vigência por prazo indeterminado, iniciando-se com o aceite eletrônico.');
  bullet(doc, 'Alterações deste instrumento serão comunicadas com antecedência mínima de 30 dias e exigirão novo aceite.');
  bullet(doc, 'A Contratante pode cancelar a qualquer tempo pela plataforma; a GenomaFlow pode suspender a conta em caso de descumprimento, fraude ou inadimplência.');
  bullet(doc, 'Dados seguirão a política de retenção prevista na Política de Privacidade.');

  section(doc, 10, 'Foro');
  p(doc, `Fica eleito o foro da Comarca de ${COMPANY.city}, com renúncia a qualquer outro, por mais privilegiado que seja, para dirimir controvérsias decorrentes deste contrato.`);

  footer(doc);
  await save(doc, 'contrato_saas.pdf');
}

// ───── 2. DPA — Data Processing Agreement ─────
async function dpa() {
  const doc = newDoc('DPA — Data Processing Agreement');
  header(doc, 'DPA — Data Processing Agreement', 'Acordo de Tratamento de Dados entre Controlador e Operador');

  section(doc, 1, 'Partes');
  p(doc, `CONTROLADOR: Clínica usuária, responsável pela coleta, finalidade e bases legais do tratamento dos dados dos pacientes, nos termos do Art 5º, VI da LGPD.`);
  p(doc, `OPERADOR: ${COMPANY.razao}, CNPJ ${COMPANY.cnpj}, ${COMPANY.city}, nos termos do Art 5º, VII da LGPD.`);

  section(doc, 2, 'Objeto e Escopo');
  p(doc, 'Este DPA regula o tratamento de dados pessoais, incluindo dados sensíveis de saúde (Art 11 LGPD), realizado pelo Operador por conta e ordem do Controlador, em decorrência da prestação dos serviços da plataforma GenomaFlow.');

  section(doc, 3, 'Natureza e Finalidade do Tratamento');
  bullet(doc, 'Processamento de laudos laboratoriais e imagens médicas por modelos de IA para gerar sugestões interpretativas, alertas e recomendações.');
  bullet(doc, 'Armazenamento seguro de exames e resultados para posterior consulta pelo profissional responsável.');
  bullet(doc, 'Geração de prescrições eletrônicas e documentos clínicos, quando acionado pelo profissional.');
  bullet(doc, 'Os dados não são utilizados para finalidade diversa da expressamente autorizada pelo Controlador.');

  section(doc, 4, 'Categorias de Dados Tratados');
  bullet(doc, 'Identificação do paciente: nome, data de nascimento, sexo, CPF (hash + últimos 4 dígitos).');
  bullet(doc, 'Dados sensíveis de saúde (Art 5º, II e Art 11 LGPD): exames, imagens (DICOM/JPG/PNG), histórico clínico, alergias, medicações, queixas.');
  bullet(doc, 'Dados de tutores (contexto veterinário): nome, contato, endereço, CPF hash.');

  section(doc, 5, 'Obrigações do Operador');
  bullet(doc, 'Tratar os dados exclusivamente conforme instruções documentadas do Controlador.');
  bullet(doc, 'Manter confidencialidade dos dados, inclusive após o término do contrato.');
  bullet(doc, 'Implementar medidas técnicas e organizacionais de segurança compatíveis (vide Política de Segurança anexa).');
  bullet(doc, 'Auxiliar o Controlador no atendimento aos direitos do titular (Art 18 LGPD) em prazo razoável.');
  bullet(doc, 'Notificar o Controlador, em até 48 horas, sobre incidentes de segurança (Política de Incidentes anexa).');
  bullet(doc, 'Eliminar ou devolver os dados ao término do contrato, conforme política de retenção.');
  bullet(doc, 'Não subcontratar sub-operadores sem autorização do Controlador, observadas as exceções deste DPA.');

  section(doc, 6, 'Sub-operadores Autorizados');
  p(doc, 'O Controlador autoriza previamente o uso dos seguintes sub-operadores:');
  bullet(doc, 'Amazon Web Services (AWS) — hospedagem, banco de dados, storage (região us-east-1 / EUA).');
  bullet(doc, 'Anthropic PBC — processamento por modelo de IA Claude (EUA).');
  bullet(doc, 'Provedores de e-mail transacional e gateway de pagamento, conforme necessidade operacional.');
  p(doc, 'A inclusão de novos sub-operadores com acesso a dados sensíveis será comunicada ao Controlador com antecedência mínima de 30 dias.');

  section(doc, 7, 'Transferência Internacional');
  p(doc, 'O Controlador reconhece que parte do processamento ocorre em servidores localizados nos Estados Unidos. A transferência observa o disposto no Art 33 da LGPD, fundamentada em cláusulas contratuais específicas com cada sub-operador e em garantias técnicas (criptografia em trânsito e em repouso, controle de acesso).');

  section(doc, 8, 'Segurança da Informação');
  bullet(doc, 'Criptografia em trânsito (TLS 1.2+) e em repouso (AES-256).');
  bullet(doc, 'Isolamento multi-tenant via Row Level Security (RLS) com FORCE em todas as tabelas com dados pessoais.');
  bullet(doc, 'Hashing de senhas (bcrypt), CPFs armazenados como hash + últimos 4 dígitos.');
  bullet(doc, 'Controle de acesso baseado em papéis (RBAC), sessão única por usuário, autenticação multifator quando aplicável.');
  bullet(doc, 'Logs de auditoria imutáveis, retidos por no mínimo 6 meses (Marco Civil Art 15).');
  bullet(doc, 'Detalhamento completo na Política de Segurança.');

  section(doc, 9, 'Notificação de Incidentes');
  p(doc, 'Em caso de incidente de segurança envolvendo dados pessoais tratados pelo Operador, este comunicará o Controlador em até 48 (quarenta e oito) horas, fornecendo informações suficientes para que o Controlador cumpra o Art 48 da LGPD (notificação à ANPD e ao titular, quando aplicável).');

  section(doc, 10, 'Retenção e Eliminação');
  bullet(doc, 'Dados clínicos: 20 anos a contar do último atendimento (Res. CFM 1.821/2007 ou equivalente CFMV).');
  bullet(doc, 'Logs de acesso: 6 meses.');
  bullet(doc, 'Registros de aceite de termos: durante a vigência + 10 anos.');
  bullet(doc, 'Após os prazos, dados são eliminados ou anonimizados irreversivelmente.');

  section(doc, 11, 'Auditoria');
  p(doc, 'Mediante aviso prévio razoável, o Controlador pode auditar o cumprimento deste DPA, por si ou mediante auditor independente, respeitadas as políticas de confidencialidade e segurança do Operador.');

  section(doc, 12, 'Vigência');
  p(doc, 'Este DPA vigora enquanto existir tratamento de dados pelo Operador em razão do contrato SaaS. Obrigações de confidencialidade e segurança sobrevivem à extinção pelos prazos legais aplicáveis.');

  footer(doc);
  await save(doc, 'dpa.pdf');
}

// ───── 3. Política de Incidentes ─────
async function politicaIncidentes() {
  const doc = newDoc('Política de Resposta a Incidentes de Segurança');
  header(doc, 'Política de Resposta a Incidentes', 'Procedimentos de detecção, contenção, notificação e análise pós-incidente');

  section(doc, 1, 'Objetivo');
  p(doc, 'Esta política estabelece o procedimento de resposta a incidentes de segurança da informação envolvendo a plataforma GenomaFlow, em conformidade com o Art 48 da LGPD e com boas práticas de gestão de incidentes.');

  section(doc, 2, 'Definição de Incidente');
  p(doc, 'Considera-se incidente qualquer evento confirmado ou suspeito que comprometa a confidencialidade, integridade ou disponibilidade de dados pessoais, incluindo, sem se limitar a:');
  bullet(doc, 'Acesso não autorizado a dados de pacientes ou credenciais.');
  bullet(doc, 'Vazamento, exposição ou alteração indevida de dados.');
  bullet(doc, 'Ataques cibernéticos (ransomware, SQL injection, DDoS), tentativas de invasão.');
  bullet(doc, 'Perda de dispositivos contendo dados sensíveis.');
  bullet(doc, 'Falha técnica com indisponibilidade superior ao SLA contratado.');

  section(doc, 3, 'Classificação e Severidade');
  bullet(doc, 'CRÍTICO — vazamento confirmado de dados sensíveis de múltiplos titulares; exposição de credenciais master; ransomware ativo.');
  bullet(doc, 'ALTO — acesso não autorizado com risco de vazamento; exploração ativa de vulnerabilidade; indisponibilidade prolongada.');
  bullet(doc, 'MÉDIO — tentativa de invasão contida; falha de controle de acesso sem confirmação de vazamento.');
  bullet(doc, 'BAIXO — anomalias detectadas sem evidência de comprometimento; erros operacionais isolados.');

  section(doc, 4, 'Equipe de Resposta');
  bullet(doc, 'Encarregado (DPO) — coordenação geral, comunicação com ANPD e titulares.');
  bullet(doc, 'Engenharia / SRE — contenção técnica, forense, mitigação.');
  bullet(doc, 'Jurídico — análise regulatória, suporte à comunicação.');
  bullet(doc, 'Comunicação — mensagens a clientes e stakeholders.');

  section(doc, 5, 'Procedimento de Resposta');
  bullet(doc, 'DETECÇÃO: via monitoramento automático, reporte de usuário ou alerta de subprocessador. Canal: security@genomaflow.com.br.');
  bullet(doc, 'TRIAGEM: em até 2 horas, classificação de severidade e acionamento da equipe.');
  bullet(doc, 'CONTENÇÃO: isolamento do componente afetado, revogação de credenciais, bloqueio de IPs suspeitos.');
  bullet(doc, 'INVESTIGAÇÃO: coleta de logs, análise forense, escopo do comprometimento, identificação dos titulares afetados.');
  bullet(doc, 'ERRADICAÇÃO: correção da causa raiz (patch, hotfix, rotação de segredos).');
  bullet(doc, 'RECUPERAÇÃO: restauração de backups validados, verificação de integridade.');
  bullet(doc, 'NOTIFICAÇÃO: conforme prazos da seção 6.');
  bullet(doc, 'ANÁLISE PÓS-INCIDENTE: post-mortem em até 10 dias úteis, identificação de melhorias, atualização de controles.');

  section(doc, 6, 'Prazos de Notificação');
  bullet(doc, 'Clientes (Controladores): em até 48 horas contadas do conhecimento do incidente.');
  bullet(doc, 'Titulares afetados: pelo Controlador, em prazo razoável considerando a natureza do risco (Art 48 LGPD).');
  bullet(doc, 'ANPD: em prazo razoável, a critério do Controlador, observadas orientações da Autoridade (Resolução CD/ANPD nº 15/2024 ou norma superveniente).');

  section(doc, 7, 'Conteúdo da Notificação');
  bullet(doc, 'Descrição do incidente e dados potencialmente afetados.');
  bullet(doc, 'Categorias de titulares e quantidade estimada de afetados.');
  bullet(doc, 'Consequências técnicas e riscos aos titulares.');
  bullet(doc, 'Medidas tomadas e em curso para mitigação.');
  bullet(doc, 'Contato do Encarregado (DPO) para informações adicionais.');

  section(doc, 8, 'Registro e Documentação');
  p(doc, 'Todos os incidentes, inclusive de severidade BAIXA, são registrados em sistema interno com histórico imutável contendo: data/hora, descrição, severidade, responsáveis, ações tomadas, conclusão. O registro fica disponível para auditoria por 5 anos.');

  section(doc, 9, 'Canal de Reporte');
  p(doc, 'Clientes, titulares e pesquisadores de segurança podem reportar incidentes ou vulnerabilidades por:');
  bullet(doc, 'E-mail: security@genomaflow.com.br');
  bullet(doc, 'Encarregado (DPO): dpo@genomaflow.com.br');

  footer(doc);
  await save(doc, 'politica_incidentes.pdf');
}

// ───── 4. Política de Segurança ─────
async function politicaSeguranca() {
  const doc = newDoc('Política de Segurança da Informação');
  header(doc, 'Política de Segurança da Informação', 'Controles técnicos e organizacionais da plataforma GenomaFlow');

  section(doc, 1, 'Princípios Orientadores');
  bullet(doc, 'Confidencialidade, integridade e disponibilidade dos dados como pilares.');
  bullet(doc, 'Defesa em profundidade — múltiplas camadas de controle.');
  bullet(doc, 'Privilégio mínimo — acesso estritamente necessário.');
  bullet(doc, 'Segurança desde a concepção (privacy & security by design — LGPD Art 46).');

  section(doc, 2, 'Controles Técnicos');
  bullet(doc, 'Criptografia em trânsito: TLS 1.2+ em todas as conexões cliente-servidor e inter-serviços.');
  bullet(doc, 'Criptografia em repouso: AES-256 para bancos de dados, storage S3 e backups.');
  bullet(doc, 'Isolamento multi-tenant: Row Level Security (RLS) com FORCE em todas as tabelas contendo dados pessoais; queries executam com tenant_id setado por transação.');
  bullet(doc, 'Hashing de credenciais: senhas com bcrypt (cost ≥ 10); CPFs armazenados como SHA-256 + últimos 4 dígitos.');
  bullet(doc, 'Autenticação: JWT assinado com secret rotacionável; sessão única por usuário (invalidação automática em login concorrente).');
  bullet(doc, 'Controle de acesso: RBAC (roles admin, master) com verificação em middleware antes de qualquer operação.');
  bullet(doc, 'Rate limiting: proteção contra abuso em endpoints sensíveis (login, chat, upload).');
  bullet(doc, 'Auditoria: logs imutáveis de autenticação, aceite de termos, acesso a prontuário, alterações de dados críticos.');
  bullet(doc, 'WAF/CDN: proxy reverso (nginx/ALB) com proteção contra OWASP Top 10 conhecidos.');
  bullet(doc, 'Backups: diários, com retenção mínima de 30 dias; testes de restauração trimestrais.');

  section(doc, 3, 'Controles Organizacionais');
  bullet(doc, 'Treinamento de segurança e LGPD para toda a equipe, com reciclagem anual.');
  bullet(doc, 'Acordo de confidencialidade (NDA) com colaboradores e prestadores.');
  bullet(doc, 'Revogação imediata de acessos no desligamento ou mudança de função.');
  bullet(doc, 'Revisão de acessos a cada 6 meses.');
  bullet(doc, 'Política de dispositivos: equipamentos corporativos com criptografia de disco, antivírus e atualizações automáticas.');
  bullet(doc, 'Política de senhas: mínimo 12 caracteres, complexidade, rotação a cada 180 dias para contas administrativas.');

  section(doc, 4, 'Gestão de Vulnerabilidades');
  bullet(doc, 'Varreduras automatizadas de dependências (npm audit, Snyk ou equivalente) em cada build.');
  bullet(doc, 'Patches de segurança críticos aplicados em até 7 dias.');
  bullet(doc, 'Pentests anuais por equipe externa; achados críticos tratados como prioridade máxima.');
  bullet(doc, 'Programa de bug bounty aberto a pesquisadores de segurança.');

  section(doc, 5, 'Continuidade e Resiliência');
  bullet(doc, 'Arquitetura multi-AZ em AWS para alta disponibilidade.');
  bullet(doc, 'Plano de Continuidade de Negócios (PCN) com RPO ≤ 24h e RTO ≤ 4h.');
  bullet(doc, 'Testes de recuperação de desastres semestrais.');
  bullet(doc, 'Redundância em componentes críticos (banco replicado, storage versionado).');

  section(doc, 6, 'Desenvolvimento Seguro');
  bullet(doc, 'Revisão de código obrigatória antes de merge para a branch principal.');
  bullet(doc, 'CI/CD com verificações automáticas de segurança (SAST, dependency check).');
  bullet(doc, 'Segregação de ambientes: desenvolvimento, homologação e produção.');
  bullet(doc, 'Secrets gerenciados em AWS Secrets Manager / SSM Parameter Store — nunca em código-fonte.');

  section(doc, 7, 'Responsabilidade');
  p(doc, 'A responsabilidade pela manutenção e atualização desta política é do Encarregado (DPO) em conjunto com a área de Engenharia. Revisões ocorrem a cada 12 meses ou sempre que houver mudança material em infraestrutura, legislação ou ameaças.');

  section(doc, 8, 'Contato');
  bullet(doc, 'Incidentes de segurança: security@genomaflow.com.br');
  bullet(doc, 'Encarregado (DPO): dpo@genomaflow.com.br');

  footer(doc);
  await save(doc, 'politica_seguranca.pdf');
}

// ───── 5. Política de Uso Aceitável ─────
async function politicaUsoAceitavel() {
  const doc = newDoc('Política de Uso Aceitável');
  header(doc, 'Política de Uso Aceitável', 'Regras de conduta e vedações para usuários da plataforma');

  section(doc, 1, 'Objeto');
  p(doc, 'Esta política estabelece os comportamentos permitidos e vedados no uso da plataforma GenomaFlow, em complemento ao Contrato SaaS. O descumprimento autoriza suspensão, rescisão e demais sanções cabíveis.');

  section(doc, 2, 'Usos Permitidos');
  bullet(doc, 'Upload e análise de exames clínicos de pacientes da própria clínica, com consentimento LGPD previamente obtido.');
  bullet(doc, 'Consulta e acompanhamento de resultados pelo profissional habilitado responsável pelo atendimento.');
  bullet(doc, 'Geração de prescrições eletrônicas e documentos clínicos, validados pelo profissional.');
  bullet(doc, 'Uso do chat clínico (RAG) para consulta sobre dados do próprio tenant.');
  bullet(doc, 'Gestão de cadastros, créditos e usuários da clínica.');

  section(doc, 3, 'Usos Vedados');
  bullet(doc, 'Compartilhar, ceder ou revender credenciais de acesso (login + senha).');
  bullet(doc, 'Criar mais de uma conta em nome da mesma pessoa para contornar limites do plano.');
  bullet(doc, 'Inserir dados de pacientes que não pertencem à clínica usuária.');
  bullet(doc, 'Utilizar a plataforma para pesquisa acadêmica em seres humanos ou animais sem aprovação de CEP/CEUA e anuência prévia da GenomaFlow.');
  bullet(doc, 'Fazer engenharia reversa, descompilar, desmontar ou tentar extrair o código-fonte, modelos de IA, prompts ou arquiteturas.');
  bullet(doc, 'Automatizar acessos (scraping, bots, RPA) sem autorização expressa e por escrito.');
  bullet(doc, 'Tentar acessar dados de outros tenants, contornar controles de isolamento ou explorar vulnerabilidades.');
  bullet(doc, 'Carregar arquivos contendo malware, vírus, código malicioso ou conteúdo ilícito.');
  bullet(doc, 'Utilizar a plataforma para emitir laudo, prescrição ou decisão clínica sem validação profissional do resultado da IA.');
  bullet(doc, 'Utilizar a plataforma em desacordo com o Código de Ética Médica, Veterinária ou resoluções do CFM/CFMV aplicáveis.');
  bullet(doc, 'Praticar qualquer conduta que viole a legislação brasileira ou direitos de terceiros.');

  section(doc, 4, 'Obrigações do Usuário');
  bullet(doc, 'Manter dados cadastrais atualizados, incluindo habilitação profissional.');
  bullet(doc, 'Proteger as credenciais de acesso com diligência — notificar imediatamente em caso de suspeita de uso indevido.');
  bullet(doc, 'Observar princípios de minimização de dados — não inserir informações desnecessárias à finalidade clínica.');
  bullet(doc, 'Respeitar os direitos do titular (paciente) previstos na LGPD.');
  bullet(doc, 'Validar todo resultado da IA antes de aplicação clínica ou comunicação ao paciente.');

  section(doc, 5, 'Propriedade Intelectual');
  p(doc, 'Todo o conteúdo do produto (código, design, modelos de IA, marcas) é de titularidade exclusiva da GenomaFlow. O Conteúdo inserido pela Clínica permanece de propriedade da Clínica/paciente — a GenomaFlow detém licença limitada e finalística para processá-lo durante a vigência contratual.');

  section(doc, 6, 'Monitoramento e Detecção de Uso Indevido');
  p(doc, 'A GenomaFlow monitora padrões de uso para identificar fraudes, abuso e violações desta política. Esse monitoramento respeita os limites da LGPD e é feito com base no legítimo interesse e execução de contrato.');

  section(doc, 7, 'Sanções');
  bullet(doc, 'Advertência formal por e-mail.');
  bullet(doc, 'Suspensão temporária da conta.');
  bullet(doc, 'Rescisão do contrato e encerramento definitivo da conta.');
  bullet(doc, 'Cobrança de multas, indenizações e custos decorrentes de dano ou investigação.');
  bullet(doc, 'Denúncia às autoridades competentes e/ou Conselhos profissionais quando cabível.');

  section(doc, 8, 'Canal de Denúncia');
  p(doc, 'Suspeitas de uso indevido podem ser reportadas confidencialmente a: compliance@genomaflow.com.br.');

  footer(doc);
  await save(doc, 'politica_uso_aceitavel.pdf');
}

(async () => {
  await contratoSaas();
  await dpa();
  await politicaIncidentes();
  await politicaSeguranca();
  await politicaUsoAceitavel();
  console.log('\n✓ Todos os PDFs gerados em:', OUT_DIR);
})();
