'use strict';
require('dotenv').config();
const path = require('path');
const { indexProductHelp } = require('./indexer-product-help');

// REPO_ROOT pra rodar fora do container. No CI, montar docs/ ou passar via env.
const REPO_ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '../../../..');

(async () => {
  console.log(`[reindex] repo root: ${REPO_ROOT}`);
  try {
    const total = await indexProductHelp(REPO_ROOT);
    console.log(`[reindex] ✓ done, ${total} chunks`);
    process.exit(0);
  } catch (err) {
    console.error('[reindex] ✗ failed:', err);
    process.exit(1);
  }
})();
