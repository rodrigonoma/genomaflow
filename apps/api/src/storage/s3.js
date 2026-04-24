const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKET = process.env.S3_BUCKET || 'genomaflow-uploads-prod';
const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

async function uploadFile(key, buffer, contentType) {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));
  return `s3://${BUCKET}/${key}`;
}

async function downloadFile(key) {
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function deleteFile(key) {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {});
}

function keyFromPath(s3Path) {
  // s3://bucket/key  or  just the key directly
  if (s3Path.startsWith('s3://')) return s3Path.split('/').slice(3).join('/');
  return s3Path;
}

async function getSignedDownloadUrl(key, expiresSeconds = 3600) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return await getSignedUrl(client, cmd, { expiresIn: expiresSeconds });
}

module.exports = { uploadFile, downloadFile, deleteFile, keyFromPath, BUCKET, getSignedDownloadUrl };
