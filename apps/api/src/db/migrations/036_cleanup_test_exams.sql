-- Remove exames de teste inválidos do tenant da Rafaela (criados durante debug do S3)
DELETE FROM clinical_results
WHERE exam_id IN (
  SELECT id FROM exams
  WHERE tenant_id = '2344dc84-e2a8-4ea3-9d10-b78d8bba1c52'
    AND status = 'error'
);

DELETE FROM exams
WHERE tenant_id = '2344dc84-e2a8-4ea3-9d10-b78d8bba1c52'
  AND status = 'error';
