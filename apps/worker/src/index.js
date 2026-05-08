require('dotenv').config();
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { processExam } = require('./processors/exam');
const { processVideoTranscription } = require('./video/transcription');
const { indexSubject, indexAggregates } = require('./rag/indexer');
const { startScheduler } = require('./notifications/scheduler');

const connection  = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const subscriber  = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const videoConn   = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker('exam-processing', async (job) => {
  console.log(`[worker] Processing job ${job.id}: exam ${job.data.exam_id}`);
  await processExam(job.data);
}, { connection, concurrency: 3 });

worker.on('completed', (job) => console.log(`[worker] Job ${job.id} completed`));
worker.on('failed',    (job, err) => console.error(`[worker] Job ${job.id} failed: ${err.message}`));

const videoWorker = new Worker('video-transcription', async (job) => {
  console.log(`[video-worker] Job ${job.id}: consultation ${job.data.consultation_id}`);
  await processVideoTranscription(job.data);
}, { connection: videoConn, concurrency: 2 });

videoWorker.on('completed', (job) => console.log(`[video-worker] Job ${job.id} completed`));
videoWorker.on('failed',    (job, err) => console.error(`[video-worker] Job ${job.id} failed: ${err.message}`));

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

console.log('[worker] Listening for exam-processing, video-transcription jobs and index events...');
