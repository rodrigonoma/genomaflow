require('dotenv').config();
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { processExam } = require('./processors/exam');

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null
});

const worker = new Worker('exam-processing', async (job) => {
  console.log(`[worker] Processing job ${job.id}: exam ${job.data.exam_id}`);
  await processExam(job.data);
}, { connection, concurrency: 3 });

worker.on('completed', (job) => {
  console.log(`[worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job.id} failed: ${err.message}`);
});

console.log('[worker] Listening for exam-processing jobs...');
