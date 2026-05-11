'use strict';

const { Queue } = require('bullmq');
const Redis = require('ioredis');

let _queue;
function queue() {
  if (!_queue) {
    const conn = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    _queue = new Queue('aesthetic-analysis', { connection: conn });
  }
  return _queue;
}

async function enqueue(payload) {
  const job = await queue().add('analyze', payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  });
  return job.id;
}

module.exports = { enqueue };
