const { GetObjectCommand, DeleteObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { client, BUCKET } = require('./s3-client');

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
