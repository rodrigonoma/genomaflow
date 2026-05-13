'use strict';

const { Queue } = require('bullmq');
const IORedis = require('ioredis');

let _queue;
function getQueue() {
  if (_queue) return _queue;
  const connection = new IORedis(
    process.env.REDIS_URL || 'redis://redis:6379',
    { maxRetriesPerRequest: null },
  );
  _queue = new Queue('trello-qa', { connection });
  return _queue;
}

async function enqueue(data) {
  return getQueue().add('process', data, {
    attempts: 1,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  });
}

module.exports = { enqueue };
