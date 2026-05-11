'use strict';

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET || 'genomaflow-uploads-prod';
const s3 = new S3Client({ region: REGION });

function buildKey({ tenantId, subjectId, photoId, ext = 'jpg' }) {
  return `aesthetic-photos/${tenantId}/${subjectId}/${photoId}.${ext}`;
}

async function uploadPhoto({ key, body, contentType }) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
  return { s3_key: key };
}

async function signedUrlFor({ key, ttlSeconds = 3600 }) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: ttlSeconds });
}

async function deletePhoto({ key }) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  return { deleted: true };
}

module.exports = { buildKey, uploadPhoto, signedUrlFor, deletePhoto };
