-- 100_aesthetic_photos_pose_landmarks.sql
-- V2 advanced grava pose + landmarks por foto. Todas NULLable — fotos F1-F6
-- legacy continuam funcionando sem mudança no payload de upload.
-- Spec §5.2.

ALTER TABLE aesthetic_photos
  ADD COLUMN IF NOT EXISTS pose VARCHAR(40),
  ADD COLUMN IF NOT EXISTS landmarks JSONB,
  ADD COLUMN IF NOT EXISTS session_id UUID
    REFERENCES aesthetic_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_aesthetic_photos_pose
  ON aesthetic_photos (tenant_id, subject_id, pose)
  WHERE pose IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_aesthetic_photos_session
  ON aesthetic_photos (session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN aesthetic_photos.pose IS
  'Pose declarada V2 (advanced tier). Facial: frontal|profile_left|profile_right|45_left|45_right. Body: body_front|body_back|body_lateral_left|body_lateral_right. NULL = legacy F1-F6 / standard tier.';

COMMENT ON COLUMN aesthetic_photos.landmarks IS
  'Landmarks MediaPipe detectados no cliente durante captura guiada. Shape em apps/api/src/services/aesthetic-landmarks-validate.js. NULL = legacy / standard tier.';

COMMENT ON COLUMN aesthetic_photos.session_id IS
  'FK opcional para aesthetic_sessions. Obrigatório quando tier=advanced em aesthetic_analyses (validado em rota).';
