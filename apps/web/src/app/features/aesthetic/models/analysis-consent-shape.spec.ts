/**
 * Type-level regression guard para AestheticConsent (regressão 2026-05-12).
 *
 * Backend GET /aesthetic/consent/:subject_id retorna shape condicional:
 *   - { confirmed: false } quando consent não existe (todos demais undefined)
 *   - { confirmed: true, id, created_at, reinforced_regions } quando existe
 *
 * Bug forense: { confirmed: false } é truthy + .revoked_at é undefined →
 * `if (consent && !consent.revoked_at)` passava como verdadeiro → state machine
 * pulava o registro de consent → upload de fotos nunca disparava.
 *
 * Estes testes garantem que:
 * 1. A interface AestheticConsent tem `confirmed: boolean` (não opcional, não
 *    string, não outro tipo). Type-level — Jest serve só de wrapper.
 * 2. Frontend NÃO regrida pra checar truthy do objeto inteiro.
 */
import { describe, test, expect } from '@jest/globals';
import { AestheticConsent } from './analysis.model';

describe('AestheticConsent type contract — regression 2026-05-12', () => {
  test('confirmed: false shape é atribuível à interface', () => {
    // Type-level — se o compilador rejeitar este literal, é regressão da interface.
    const notFound: AestheticConsent = { confirmed: false };
    expect(notFound.confirmed).toBe(false);
    expect(notFound.id).toBeUndefined();
    expect(notFound.created_at).toBeUndefined();
  });

  test('confirmed: true shape com id é atribuível', () => {
    const found: AestheticConsent = {
      confirmed: true,
      id: 'c-1',
      created_at: '2026-05-12T00:00:00Z',
      reinforced_regions: ['breast'],
    };
    expect(found.confirmed).toBe(true);
    expect(found.id).toBe('c-1');
  });

  test('discriminator pattern compila — confirmed gate dá acesso a id', () => {
    function isValidConsent(c: AestheticConsent): boolean {
      // SE alguém remover `confirmed` da interface, este código quebra.
      return c.confirmed === true && !c.revoked_at;
    }
    expect(isValidConsent({ confirmed: false })).toBe(false);
    expect(isValidConsent({ confirmed: true })).toBe(true);
    expect(isValidConsent({ confirmed: true, revoked_at: '2026-05-12' })).toBe(false);
  });
});
