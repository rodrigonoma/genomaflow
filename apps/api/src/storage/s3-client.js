'use strict';

const { S3Client } = require('@aws-sdk/client-s3');

// S3Client compartilhado entre os módulos de storage. Suporta dois modos:
//
//   1) AWS S3 nativo (padrão em prod AWS) — quando S3_ENDPOINT não é setado.
//      Credenciais via task role do ECS ou env vars AWS_*.
//
//   2) S3-compatible externo (MinIO self-host na VPS, Cloudflare R2, Backblaze
//      B2, etc) — quando S3_ENDPOINT está setado. Exige credenciais explícitas
//      em S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY (não reusa AWS_* porque a
//      conta AWS continua sendo necessária pro Chime).
//
// MinIO exige forcePathStyle=true (URL `https://endpoint/bucket/key` em vez de
// virtual-host `https://bucket.endpoint/key`). R2/B2 aceitam ambos.
const REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
const ENDPOINT = process.env.S3_ENDPOINT || null;

const clientConfig = { region: REGION };

if (ENDPOINT) {
  clientConfig.endpoint = ENDPOINT;
  clientConfig.forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== 'false';
  // Credenciais explícitas — não cair no provider chain default que tentaria
  // EC2 instance metadata (não existe na VPS) ou shared credentials file.
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
