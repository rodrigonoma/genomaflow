/**
 * Gera o template do Termo de Consentimento LGPD para impressão e assinatura
 * pelo paciente ou responsável legal.
 *
 * O PDF tem os dados da clínica pré-preenchidos (quando fornecidos) e campos
 * em branco para preenchimento manual no atendimento.
 */

interface ClinicInfo {
  name?: string;
  cnpj?: string | null;
}

export async function generateConsentTemplatePdf(clinic?: ClinicInfo): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(27, 27, 100);
  doc.text('TERMO DE CONSENTIMENTO LIVRE E INFORMADO', 105, 20, { align: 'center' });
  doc.setFontSize(11);
  doc.text('LGPD — Tratamento de Dados de Saúde por IA', 105, 27, { align: 'center' });

  doc.setDrawColor(192, 193, 255);
  doc.line(15, 32, 195, 32);

  doc.setTextColor(30, 30, 60);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  let y = 42;
  const add = (text: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(text, 180);
    doc.text(lines, 15, y);
    y += lines.length * 5 + 2;
  };

  add(`Clínica: ${clinic?.name ?? '__________________________________________________________'}`);
  add(`CNPJ: ${clinic?.cnpj ?? '__________________________________'}`);
  y += 2;

  add('1. IDENTIFICAÇÃO DO PACIENTE / RESPONSÁVEL', true);
  add('Paciente: ______________________________________________ CPF: ____________________');
  add('Data de nascimento: ___/___/______     Sexo: (  ) M   (  ) F   (  ) Outro');
  add('Responsável legal (se aplicável): ______________________________________________');
  add('CPF do responsável: __________________   Grau de parentesco: _____________________');
  y += 2;

  add('2. FINALIDADE DO TRATAMENTO', true);
  add(
    'A Clínica utiliza a plataforma GenomaFlow — software de Suporte à Decisão Clínica ' +
    'assistido por Inteligência Artificial — para auxiliar o profissional de saúde ' +
    'responsável pelo meu atendimento na interpretação de exames e imagens médicas.'
  );
  add(
    'Os dados processados incluem: exames laboratoriais, imagens médicas (DICOM, JPG, PNG), ' +
    'alergias, medicações em uso, queixas e histórico clínico.'
  );
  y += 2;

  add('3. DECLARAÇÕES IMPORTANTES', true);
  add('• A plataforma NÃO substitui o diagnóstico médico ou veterinário.');
  add('• Toda decisão clínica permanece sob responsabilidade do profissional que me atende.');
  add('• Os dados são tratados em conformidade com a LGPD (Lei 13.709/2018).');
  add('• Parte do processamento ocorre em servidores fora do Brasil, com garantias contratuais adequadas.');
  add('• Os dados serão mantidos pelo prazo mínimo de 20 anos (Res. CFM 1.821/2007) ou equivalente.');
  y += 2;

  add('4. MEUS DIREITOS (Art 18 LGPD)', true);
  add(
    'Posso, a qualquer tempo, solicitar acesso, correção, eliminação, portabilidade dos meus ' +
    'dados, bem como revogar este consentimento, entrando em contato com o Encarregado da Clínica.'
  );
  y += 2;

  add('5. MANIFESTAÇÃO DO CONSENTIMENTO', true);
  add('(  ) CONCORDO com o tratamento dos meus dados (ou do paciente sob minha responsabilidade) conforme descrito neste termo.');
  add('(  ) NÃO CONCORDO — ciente de que a análise por IA não será realizada, mas o atendimento convencional está garantido.');
  y += 6;

  add('Local e data: ______________________________________, ___ de _______________ de 20___');
  y += 18;

  doc.line(15, y, 95, y);
  doc.setFontSize(9);
  doc.text('Assinatura do Paciente / Responsável', 15, y + 5);

  doc.line(110, y, 195, y);
  doc.text('Assinatura do Profissional (CRM/CRMV)', 110, y + 5);

  doc.setFontSize(7);
  doc.setTextColor(120, 120, 140);
  doc.text(
    'Termo de Consentimento LGPD · v1.0 · GenomaFlow',
    105, 285, { align: 'center' }
  );

  doc.save('termo-consentimento-lgpd.pdf');
}
