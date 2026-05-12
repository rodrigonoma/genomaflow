'use strict';

// Bug forensicamente confirmado em prod 2026-05-12: POST /aesthetic/analyses
// retornava 500 com 'column "ref_id" of relation "credit_ledger" does not exist'.
// O código aesthetic-credits.js fazia INSERT em ref_id mas a coluna nunca foi
// criada — schema original (migration 016) só tem exam_id.
//
// Fix: migration 097_credit_ledger_ref_id.sql adicionou a coluna.
// Este test garante que a migration foi shipada + que SELECT/INSERT mencionam
// a coluna (regression guard).

const fs = require('fs');
const path = require('path');

describe('credit_ledger.ref_id — regression guard (2026-05-12)', () => {
  test('migration 097 cria coluna ref_id em credit_ledger', () => {
    const m = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'db', 'migrations', '097_credit_ledger_ref_id.sql'),
      'utf8'
    );
    expect(m).toMatch(/ALTER TABLE credit_ledger ADD COLUMN .* ref_id UUID/i);
  });

  test('aesthetic-credits.js INSERT referencia ref_id', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'services', 'aesthetic-credits.js'),
      'utf8'
    );
    expect(src).toMatch(/INSERT INTO credit_ledger[\s\S]*?ref_id/);
  });
});
