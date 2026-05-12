'use strict';

// Bug 2026-05-12: worker publishes 'aesthetic:event:{tenant_id}' on analysis_done,
// mas pubsub.js do api não tinha esse pattern no psubscribe list.
// Frontend ficava esperando WS event que nunca chegava → spinner eterno.
// Esse test garante que aesthetic:event:* fica subscribed e o handler tem branch
// específico (source inspection — sem precisar de Redis real).

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'plugins', 'pubsub.js'),
  'utf8'
);

describe('pubsub plugin — aesthetic:event:* (regression 2026-05-12)', () => {
  test('psubscribe inclui aesthetic:event:*', () => {
    expect(SOURCE).toMatch(/psubscribe\([\s\S]*?'aesthetic:event:\*'/);
  });

  test('handler tem branch para aesthetic:event: (extrai tenantId + payload)', () => {
    expect(SOURCE).toMatch(/channel\.startsWith\(['"]aesthetic:event:['"]\)/);
  });
});
