'use strict';
const fs = require('fs/promises');
const path = require('path');
const { Pool } = require('pg');
const OpenAI = require('openai');
const { chunkText } = require('./chunker');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Diretórios que entram no índice. Paths relativos ao root do repo.
const SOURCES = [
  { dir: 'docs/superpowers/plans', sourceKind: 'plan' },
  { dir: 'docs/superpowers/specs', sourceKind: 'spec' },
  { dir: 'docs/claude-memory', sourceKind: 'memory' },
];

// Arquivos únicos na raiz
const SINGLE_FILES = [
  { path: 'CLAUDE.md', sourceKind: 'premises' },
];

async function embedBatch(texts) {
  const embeddings = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100).map(t => t.slice(0, 8000));
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch
    });
    embeddings.push(...res.data.map(d => d.embedding));
  }
  return embeddings;
}

async function walkMd(rootDir, dir) {
  const abs = path.join(rootDir, dir);
  try { await fs.access(abs); } catch { return []; }
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      out.push(...await walkMd(rootDir, path.join(dir, e.name)));
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

async function indexProductHelp(repoRoot) {
  const client = await pool.connect();
  try {
    // Apaga docs de product_help antes de reindexar — idempotente por rerun
    await client.query(`DELETE FROM rag_documents WHERE namespace = 'product_help'`);
    console.log('[product-help] cleared previous product_help docs');

    const allFiles = [];
    for (const src of SOURCES) {
      const files = await walkMd(repoRoot, src.dir);
      for (const f of files) allFiles.push({ path: f, sourceKind: src.sourceKind });
    }
    for (const f of SINGLE_FILES) {
      try {
        await fs.access(path.join(repoRoot, f.path));
        allFiles.push({ path: f.path, sourceKind: f.sourceKind });
      } catch { /* skip if missing */ }
    }

    console.log(`[product-help] found ${allFiles.length} markdown files to index`);

    let totalChunks = 0;
    for (const { path: relPath, sourceKind } of allFiles) {
      const abs = path.join(repoRoot, relPath);
      const content = await fs.readFile(abs, 'utf-8');
      const chunks = chunkText(content, 1500, 200);
      if (chunks.length === 0) continue;

      const titles = chunks.map((_, i) => `${relPath}#${i + 1}`);
      const embeddings = await embedBatch(chunks);

      for (let i = 0; i < chunks.length; i++) {
        await client.query(
          `INSERT INTO rag_documents (namespace, source, title, content, embedding, module)
           VALUES ('product_help', $1, $2, $3, $4, 'both')
           ON CONFLICT (source, title) DO UPDATE
             SET content = EXCLUDED.content,
                 embedding = EXCLUDED.embedding`,
          [`${sourceKind}:${relPath}`, titles[i], chunks[i], JSON.stringify(embeddings[i])]
        );
      }
      totalChunks += chunks.length;
      console.log(`[product-help] ${relPath} → ${chunks.length} chunks`);
    }

    console.log(`[product-help] total indexed: ${totalChunks} chunks`);
    return totalChunks;
  } finally {
    client.release();
  }
}

module.exports = { indexProductHelp };
