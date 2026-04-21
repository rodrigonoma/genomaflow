const { S3Client, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET = process.env.S3_BUCKET || 'genomaflow-uploads-prod';
const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

async function downloadFile(key) {
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function uploadFile(key, buffer, contentType) {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));
  return `s3://${BUCKET}/${key}`;
}

async function deleteFile(key) {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {});
}

function keyFromPath(s3Path) {
  if (s3Path.startsWith('s3://')) return s3Path.split('/').slice(3).join('/');
  return s3Path;
}

module.exports = { downloadFile, uploadFile, deleteFile, keyFromPath, BUCKET };
