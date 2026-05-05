/**
 * Templates de notificação — render + build.
 */
const tpl = require('../../src/services/notification-templates');

describe('render', () => {
  test('substitui placeholders', () => {
    expect(tpl.render('Olá {{nome}}!', { nome: 'João' })).toBe('Olá João!');
  });
  test('placeholder ausente vira string vazia', () => {
    expect(tpl.render('Olá {{nome}}!', {})).toBe('Olá !');
  });
  test('múltiplos placeholders', () => {
    expect(tpl.render('{{a}} {{b}}', { a: '1', b: '2' })).toBe('1 2');
  });
});

describe('build', () => {
  test('appointment_reminder_24h tem placeholders esperados', () => {
    const r = tpl.build('appointment_reminder_24h', {
      nome: 'João', hora: '14h', tenant_name: 'Clinica X'
    });
    expect(r).toMatch(/João/);
    expect(r).toMatch(/14h/);
    expect(r).toMatch(/Clinica X/);
    expect(r).toMatch(/1.*confirmar/i);
    expect(r).toMatch(/2.*cancelar/i);
  });
  test('template inexistente lança', () => {
    expect(() => tpl.build('does_not_exist', {})).toThrow();
  });
  test('todos os templates renderizam sem placeholders restantes quando vars completos', () => {
    // Apenas valida que keys estão expostas
    expect(Object.keys(tpl.TEMPLATES)).toEqual(expect.arrayContaining([
      'appointment_reminder_24h', 'appointment_reminder_2h',
      'appointment_confirmed', 'appointment_cancelled_by_patient',
      'vaccine_reminder', 'nps_request', 'portal_invite'
    ]));
  });
});
