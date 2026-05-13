'use strict';

/**
 * BullMQ queue stub no lado da API. Usa mesmo Redis do worker.
 * O worker monta o consumidor real em apps/worker/src/queues/aesthetic-depth-queue.js.
 *
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase3-design.md §7.1
 */

const { Queue } = require('bullmq');
const IORedis = require('ioredis');

let _queue;

function getQueue() {
  if (_queue) return _queue;
  const connection = new IORedis(process.env.REDIS_URL || 'redis://redis:6379', {
    maxRetriesPerRequest: null,
  });
  _queue = new Queue('aesthetic-depth', { connection });
  return _queue;
}

async function enqueue(data) {
  return getQueue().add('process', data, {
    attempts: 1,                  // depth é caro — não retry automático
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  });
}

module.exports = { enqueue };
