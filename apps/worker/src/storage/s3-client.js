'use strict';

const { S3Client } = require('@aws-sdk/client-s3');

// Worker version do S3 client. Mesma lógica do api/src/storage/s3-client.js.
// Duplicado intencionalmente pra não compartilhar código entre os dois apps
// (api e worker são packages independentes com seus próprios node_modules).
const REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
const ENDPOINT = process.env.S3_ENDPOINT || null;

const clientConfig = { region: REGION };

if (ENDPOINT) {
  clientConfig.endpoint = ENDPOINT;
  clientConfig.forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== 'false';
  if (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId:     process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    };
  }
}

const client = new S3Client(clientConfig);

const BUCKET = process.env.S3_BUCKET || 'genomaflow-uploads-prod';

module.exports = { client, BUCKET, REGION, ENDPOINT };
