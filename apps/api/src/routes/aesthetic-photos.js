'use strict';

const { randomUUID } = require('crypto');
const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { buildKey, uploadPhoto, signedUrlFor } = require('../services/aesthetic-s3');
const { createPhoto, getPhotoForTenant, softDeletePhoto } = require('../services/aesthetic-photos');
const { autoCropSensitive } = require('../services/aesthetic-auto-crop');
const { getConsent } = require('../services/aesthetic-consent');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const MAX_BYTES = 5 * 1024 * 1024;

module.exports = async function (fastify) {
  // POST /aesthetic/photos (multipart)
  fastify.post('/photos', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const parts = request.parts();
    const fields = {};
    let fileBuf, fileMime;
    for await (const part of parts) {
      if (part.type === 'file') {
        if (!ALLOWED_MIME.has(part.mimetype)) {
          return reply.status(400).send({ error: 'Formato não suportado. Use JPEG ou PNG.' });
        }
        fileMime = part.mimetype;
        const chunks = [];
        for await (const c of part.file) chunks.push(c);
        fileBuf = Buffer.concat(chunks);
        if (fileBuf.length > MAX_BYTES) {
          return reply.status(400).send({ error: 'Arquivo maior que 5MB.' });
        }
      } else {
        fields[part.fieldname] = part.value;
      }
    }
    const { subject_id, photo_type, notes } = fields;
    if (!subject_id || !photo_type) {
      return reply.status(400).send({ error: 'subject_id e photo_type obrigatórios' });
    }
    if (!fileBuf) {
      return reply.status(400).send({ error: 'Arquivo obrigatório no campo "file"' });
    }

    // Parse is_sensitive + auto_crop from multipart fields
    const isSensitiveField = fields.is_sensitive === 'true' || fields.is_sensitive === '1';
    // auto_crop defaults to true when is_sensitive=true; false otherwise.
    // Client can explicitly pass auto_crop=false to opt out even when sensitive.
    const autoCropEnabled = isSensitiveField
      ? (fields.auto_crop !== 'false' && fields.auto_crop !== '0')
      : false;

    // Pre-flight: foto sensível exige consentimento reforçado registrado
    if (isSensitiveField) {
      const consent = await getConsent(fastify.pg, request.user.tenant_id, subject_id);
      const reinforced = consent && Array.isArray(consent.reinforced_regions) ? consent.reinforced_regions : [];
      if (!consent || reinforced.length === 0) {
        return reply.status(403).send({
          error: 'CONSENT_REINFORCED_MISSING',
          message: 'Upload de foto sensível exige consentimento reforçado do paciente registrado previamente.',
        });
      }
    }

    let autoCropApplied = 0;
    if (isSensitiveField && autoCropEnabled) {
      try {
        const result = await autoCropSensitive({ buffer: fileBuf, mime: fileMime });
        fileBuf = result.buffer;
        autoCropApplied = result.applied || 0;
        if (result.error) {
          request.log.warn({ err: result.error }, 'aesthetic auto-crop detection failed — uploading original buffer');
        }
      } catch (err) {
        // Non-fatal: log warning and continue upload with original buffer
        request.log.warn({ err: err.message }, 'aesthetic auto-crop threw unexpectedly — uploading original buffer');
      }
    }

    const photoId = randomUUID();
    const ext = fileMime === 'image/png' ? 'png' : 'jpg';
    const key = buildKey({ tenantId: request.user.tenant_id, subjectId: subject_id, photoId, ext });
    await uploadPhoto({ key, body: fileBuf, contentType: fileMime });
    const photo = await createPhoto(fastify.pg, {
      tenantId: request.user.tenant_id,
      subjectId: subject_id,
      userId: request.user.user_id,
      photoType: photo_type,
      s3Key: key,
      notes: notes ? String(notes).slice(0, 1000) : null,
      isSensitive: isSensitiveField,
    });
    return reply.status(201).send({
      id: photo.id, s3_key: photo.s3_key, photo_type: photo.photo_type,
      is_sensitive: photo.is_sensitive, taken_at: photo.taken_at,
      auto_crop_applied: autoCropApplied,
    });
  });

  // GET /aesthetic/photos/:id/url (signed)
  fastify.get('/photos/:id/url', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const photo = await getPhotoForTenant(fastify.pg, request.params.id, request.user.tenant_id);
    if (!photo || photo.deleted_at) return reply.status(404).send({ error: 'Photo não encontrada' });
    const url = await signedUrlFor({ key: photo.s3_key, ttlSeconds: 3600 });
    return reply.send({ url, expires_in: 3600 });
  });

  // DELETE /aesthetic/photos/:id (soft)
  fastify.delete('/photos/:id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const ok = await softDeletePhoto(fastify.pg, request.params.id, request.user.tenant_id, request.user.user_id);
    if (!ok) return reply.status(404).send({ error: 'Photo não encontrada ou já apagada' });
    return reply.status(204).send();
  });
};
