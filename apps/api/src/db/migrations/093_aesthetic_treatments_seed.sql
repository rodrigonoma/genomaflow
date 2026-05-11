-- 093_aesthetic_treatments_seed.sql
-- Catálogo inicial GenomaFlow (~22 tratamentos comuns no mercado BR 2026).
-- tenant_id = NULL (global).
-- Re-runs são idempotentes via WHERE NOT EXISTS.
-- Trigger de audit desabilitado durante seed: linhas globais (tenant_id NULL)
-- não têm tenant de destino no audit_log (NOT NULL constraint). Trigger é
-- reabilitado ao final — rows de clínicas continuam sendo auditadas normalmente.
-- Spec §8.1

-- Desabilitar trigger de audit pra seed (linhas globais não são auditáveis)
ALTER TABLE aesthetic_treatments DISABLE TRIGGER aesthetic_treatments_audit;

DO $$
BEGIN
  -- Corpo modelagem
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Criolipólise', 'corpo_modelagem',
    ARRAY['culote_esquerdo','culote_direito','flacidez_abdominal','volume_aparente_abdomen'],
    ARRAY['gravidez','hernia_incisional','crioglobulinemia','doenca_raynaud'],
    3, 60, 1500.00, 3500.00, 'B',
    'Lipólise por resfriamento controlado. Reduz adipócitos em áreas localizadas.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Criolipólise') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Lipocavitação', 'corpo_modelagem',
    ARRAY['culote_esquerdo','culote_direito','celulite_coxas','flacidez_abdominal'],
    ARRAY['gravidez','marcapasso','tumor_ativo'],
    8, 7, 150.00, 350.00, 'C',
    'Ultrassom de baixa frequência pra rompimento de adipócitos.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Lipocavitação') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Radiofrequência Corporal', 'corpo_flacidez',
    ARRAY['flacidez_abdominal','flacidez_triceps','flacidez_interna_coxa','firmeza_gluteos'],
    ARRAY['gravidez','marcapasso','metal_implant'],
    10, 7, 200.00, 500.00, 'B',
    'RF estética pra estímulo de colágeno e melhora de flacidez.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Radiofrequência Corporal') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'HIFU Corporal', 'corpo_modelagem',
    ARRAY['flacidez_abdominal','flacidez_triceps','volume_aparente_abdomen'],
    ARRAY['gravidez','tumor_ativo'],
    1, 180, 2500.00, 5000.00, 'B',
    'Ultrassom microfocado de alta intensidade pra flacidez profunda.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('HIFU Corporal') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Carboxiterapia', 'corpo_modelagem',
    ARRAY['celulite_coxas','celulite_gluteos','estrias_abdominais','estrias_coxas'],
    ARRAY['gravidez','insuficiencia_cardiaca','dpoc'],
    10, 7, 100.00, 250.00, 'C',
    'Infiltração subcutânea de CO2 medicinal pra microcirculação.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Carboxiterapia') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Endermologie', 'corpo_modelagem',
    ARRAY['celulite_coxas','celulite_gluteos','flacidez_triceps'],
    ARRAY['gravidez','varizes_severas','feridas_abertas'],
    14, 7, 120.00, 300.00, 'C',
    'Massagem mecanizada com sucção pra mobilização tecidual.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Endermologie') AND tenant_id IS NULL);

  -- Facial rejuvenescimento
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Microagulhamento', 'facial_rejuvenescimento',
    ARRAY['rugas','firmeza','elasticidade','textura','poros','acne'],
    ARRAY['gravidez','herpes_ativo','acne_inflamada_severa','dermatite_ativa'],
    4, 30, 300.00, 800.00, 'A',
    'Indução percutânea de colágeno via micro-agulhas. Trata rugas finas, cicatrizes e textura.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Microagulhamento') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Radiofrequência Microagulhada', 'facial_rejuvenescimento',
    ARRAY['rugas','firmeza','elasticidade','textura','poros'],
    ARRAY['gravidez','marcapasso','herpes_ativo'],
    3, 45, 800.00, 2500.00, 'A',
    'RF associada a micro-agulhas (Morpheus8, Vivace, etc) pra remodelação profunda.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Radiofrequência Microagulhada') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Laser Fracionado CO2', 'facial_rejuvenescimento',
    ARRAY['rugas','textura','manchas','uniformidade_tom'],
    ARRAY['gravidez','herpes_ativo','fototipo_5_6','queloide'],
    2, 90, 1500.00, 4000.00, 'A',
    'Laser CO2 ablativo fracionado pra resurfacing facial.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Laser Fracionado CO2') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'HIFU Facial', 'facial_rejuvenescimento',
    ARRAY['firmeza','elasticidade','rugas','simetria'],
    ARRAY['gravidez','metal_implant_facial'],
    1, 180, 1800.00, 5500.00, 'B',
    'Ultraformer/Ulthera — ultrassom microfocado pra lifting não-invasivo.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('HIFU Facial') AND tenant_id IS NULL);

  -- Facial pigmentação
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Peeling Químico Glicólico', 'facial_pigmentacao',
    ARRAY['manchas','uniformidade_tom','textura','rugas'],
    ARRAY['gravidez','dermatite_ativa','herpes_ativo'],
    6, 21, 150.00, 400.00, 'A',
    'Ácido glicólico em concentrações graduais. Trata fotoenvelhecimento leve a moderado.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Peeling Químico Glicólico') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Peeling Químico TCA', 'facial_pigmentacao',
    ARRAY['manchas','rugas','textura','uniformidade_tom'],
    ARRAY['gravidez','fototipo_5_6_alto_risco','dermatite_ativa'],
    1, 90, 600.00, 1800.00, 'A',
    'Ácido tricloroacético em concentrações 10-35%. Profundidade variável.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Peeling Químico TCA') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Luz Pulsada (IPL)', 'facial_pigmentacao',
    ARRAY['manchas','vermelhidao','uniformidade_tom','poros'],
    ARRAY['gravidez','bronzeamento_recente','medicacao_fotossensibilizante'],
    5, 30, 300.00, 900.00, 'A',
    'Luz intensa pulsada pra fotorrejuvenescimento e tratamento de manchas/vasinhos.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Luz Pulsada (IPL)') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Laser Q-Switched', 'facial_pigmentacao',
    ARRAY['manchas','melasma','tatuagem','pigmentacao_pos_inflamatoria'],
    ARRAY['gravidez','melasma_severo_indicacao_relativa'],
    4, 45, 400.00, 1200.00, 'A',
    'Laser de pulso curto pra fragmentação de pigmentos dérmicos.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Laser Q-Switched') AND tenant_id IS NULL);

  -- Facial acne
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Limpeza de Pele Profunda', 'facial_acne',
    ARRAY['acne','poros','textura','uniformidade_tom'],
    ARRAY['acne_inflamada_severa','dermatite_ativa','rosacea_ativa'],
    6, 30, 100.00, 250.00, 'B',
    'Limpeza com extração comedônica + tônicos. Manutenção mensal.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Limpeza de Pele Profunda') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Peeling Salicílico', 'facial_acne',
    ARRAY['acne','poros','textura','vermelhidao'],
    ARRAY['gravidez','alergia_salicilato'],
    6, 21, 180.00, 400.00, 'A',
    'Ácido salicílico 20-30% — anti-inflamatório e comedolítico.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Peeling Salicílico') AND tenant_id IS NULL);

  -- Facial preenchimento
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Ácido Hialurônico Facial', 'facial_preenchimento',
    ARRAY['rugas','firmeza','simetria','elasticidade'],
    ARRAY['gravidez','infeccao_local','autoimune_grave'],
    1, 365, 1500.00, 4500.00, 'A',
    'Preenchimento dérmico — sulcos, lábios, malar, mento. Validade 6-18 meses.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Ácido Hialurônico Facial') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Bioestimulador de Colágeno', 'facial_preenchimento',
    ARRAY['rugas','firmeza','elasticidade','textura'],
    ARRAY['gravidez','queloide','infeccao_local'],
    2, 60, 1800.00, 4000.00, 'B',
    'Sculptra (PLLA) ou Radiesse (HA-CaHA) — estimulam neocolagênese.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Bioestimulador de Colágeno') AND tenant_id IS NULL);

  -- Facial toxina
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Toxina Botulínica', 'facial_toxina',
    ARRAY['rugas','simetria','flacidez_palpebra_superior'],
    ARRAY['gravidez','miastenia_gravis','infeccao_local','alergia_albumina'],
    1, 120, 800.00, 2500.00, 'A',
    'Botox/Dysport/Xeomin pra rugas dinâmicas (glabela, frontal, periorbitais).',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Toxina Botulínica') AND tenant_id IS NULL);

  -- Cabelo
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Mesoterapia Capilar', 'cabelo',
    ARRAY['alopecia','queda_capilar','espessamento_fio'],
    ARRAY['gravidez','infeccao_couro_cabeludo','dermatite_ativa'],
    8, 14, 200.00, 600.00, 'B',
    'Injeção intradérmica de vitaminas/minoxidil/finasterida no couro cabeludo.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Mesoterapia Capilar') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'PRP Capilar', 'cabelo',
    ARRAY['alopecia','queda_capilar','espessamento_fio'],
    ARRAY['gravidez','infeccao_local','plaquetopenia'],
    4, 30, 400.00, 1500.00, 'B',
    'Plasma rico em plaquetas autólogo pra estímulo folicular.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('PRP Capilar') AND tenant_id IS NULL);

  -- Wellness
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Drenagem Linfática Manual', 'wellness_drenagem',
    ARRAY['celulite_coxas','celulite_gluteos','flacidez_abdominal','volume_aparente_abdomen'],
    ARRAY['trombose_ativa','infeccao_local','feridas_abertas','tumor_metastatico'],
    10, 7, 80.00, 200.00, 'B',
    'Massagem específica que estimula drenagem linfática e melhora retenção.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Drenagem Linfática Manual') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Massagem Modeladora', 'wellness_drenagem',
    ARRAY['culote_esquerdo','culote_direito','celulite_coxas','firmeza_gluteos'],
    ARRAY['trombose_ativa','feridas_abertas','tumor_metastatico'],
    10, 7, 100.00, 250.00, 'C',
    'Massagem manual intensa pra remodelar tecidos.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Massagem Modeladora') AND tenant_id IS NULL);
END $$;

-- Reabilitar trigger de audit para operações normais de tenant
ALTER TABLE aesthetic_treatments ENABLE TRIGGER aesthetic_treatments_audit;
