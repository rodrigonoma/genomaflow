-- 096_clinical_encounters_aesthetic_link.sql
-- Link opcional do encounter pra uma aesthetic_analyses.
-- Use case: encounter pos_procedimento referenciado da análise IA que motivou o agendamento.
-- Aditivo, nullable, ON DELETE SET NULL — encounter sobrevive ao apagamento da análise.
-- Spec §4.6, §9.3.

ALTER TABLE clinical_encounters
  ADD COLUMN IF NOT EXISTS related_aesthetic_analysis_id UUID NULL
    REFERENCES aesthetic_analyses(id) ON DELETE SET NULL;

-- Index parcial só pra rows com link
CREATE INDEX IF NOT EXISTS idx_clinical_encounters_aesthetic_link
  ON clinical_encounters(related_aesthetic_analysis_id)
  WHERE related_aesthetic_analysis_id IS NOT NULL;
