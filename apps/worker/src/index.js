require('dotenv').config();
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { processExam } = require('./processors/exam');
const { processVideoTranscription } = require('./video/transcription');
const { indexSubject, indexAggregates } = require('./rag/indexer');
const { startScheduler } = require('./notifications/scheduler');
const { processAestheticAnalysis } = require('./processors/aesthetic-analysis');

const connection    = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const subscriber    = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const videoConn     = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const aestheticConn = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker('exam-processing', async (job) => {
  console.log(`[worker] Processing job ${job.id}: exam ${job.data.exam_id}`);
  await processExam(job.data);
}, {
  connection,
  concurrency: 3,
  removeOnComplete: { age: 3600 },        // retém histórico de 1h pós-sucesso
  removeOnFail:     { age: 86400 },       // retém falhas por 24h pra debug
});

worker.on('completed', (job) => console.log(`[worker] Job ${job.id} completed`));
worker.on('failed',    (job, err) => console.error(`[worker] Job ${job.id} failed: ${err.message}`));

const videoWorker = new Worker('video-transcription', async (job) => {
  console.log(`[video-worker] Job ${job.id}: consultation ${job.data.consultation_id}`);
  await processVideoTranscription(job.data);
}, {
  connection: videoConn,
  concurrency: 2,
  removeOnComplete: { age: 3600 },
  removeOnFail:     { age: 86400 },
});

videoWorker.on('completed', (job) => console.log(`[video-worker] Job ${job.id} completed`));
videoWorker.on('failed',    (job, err) => console.error(`[video-worker] Job ${job.id} failed: ${err.message}`));

const aestheticWorker = new Worker('aesthetic-analysis', async (job) => {
  console.log(`[aesthetic-worker] Job ${job.id}: analysis ${job.data.analysis_id}`);
  await processAestheticAnalysis({ data: job.data });
}, {
  connection: aestheticConn,
  concurrency: 2,
  removeOnComplete: { age: 3600 },
  removeOnFail:     { age: 86400 },
});

aestheticWorker.on('completed', (job) => console.log(`[aesthetic-worker] Job ${job.id} completed`));
aestheticWorker.on('failed',    (job, err) => console.error(`[aesthetic-worker] Job ${job.id} failed: ${err.message}`));

subscriber.psubscribe('subject:upserted:*', 'billing:updated:*', (err) => {
  if (err) console.error('[worker] Subscribe error:', err.message);
});

subscriber.on('pmessage', async (_pattern, channel, message) => {
  try {
    const data = JSON.parse(message);

    if (channel.startsWith('subject:upserted:')) {
      const tenant_id = channel.replace('subject:upserted:', '');
      const { subject_id } = data;
      console.log(`[worker] Re-indexing subject ${subject_id}`);
      await indexSubject(subject_id, tenant_id);
      await indexAggregates(tenant_id);

    } else if (channel.startsWith('billing:updated:')) {
      const tenant_id = channel.replace('billing:updated:', '');
      console.log(`[worker] Re-indexing aggregates (billing) for tenant ${tenant_id}`);
      await indexAggregates(tenant_id);
    }
  } catch (err) {
    console.error('[worker] Re-index error:', err.message);
  }
});

// Fase 3 PMS expansion — scheduler de lembretes WhatsApp/email
startScheduler();

// Graceful shutdown: ECS envia SIGTERM antes de matar o container.
// Sem isso, jobs em andamento ficam stuck em 'processing' e o BullMQ retenta infinitamente.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received, closing gracefully...`);
  const results = await Promise.allSettled([
    worker.close(),
    videoWorker.close(),
    aestheticWorker.close(),
    subscriber.quit(),
    connection.quit(),
    videoConn.quit(),
    aestheticConn.quit(),
  ]);
  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length) {
    console.error('[worker] Shutdown errors:', failures.map(f => f.reason?.message));
    process.exit(1);
  }
  console.log('[worker] Shutdown complete');
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

console.log('[worker] Listening for exam-processing, video-transcription, aesthetic-analysis jobs and index events...');
