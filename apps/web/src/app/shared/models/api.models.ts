export interface Owner {
  id: string;
  name: string;
  cpf_last4?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  created_at: string;
}

export interface TreatmentItem {
  id?: string;
  label: string;
  value?: string;
  frequency?: string;
  duration?: string;
  notes?: string;
  sort_order?: number;
}

export interface TreatmentPlan {
  id: string;
  subject_id: string;
  exam_id?: string;
  type: 'therapeutic' | 'nutritional';
  status: 'active' | 'completed' | 'cancelled';
  title: string;
  description?: string;
  items: TreatmentItem[];
  created_at: string;
  updated_at: string;
}

export interface Subject {
  id: string;
  name: string;
  sex: string;
  subject_type: 'human' | 'animal';
  birth_date?: string;
  cpf_hash?: string;
  cpf_last4?: string;
  phone?: string;
  weight?: number;
  height?: number;
  blood_type?: string;
  allergies?: string;
  comorbidities?: string;
  notes?: string;
  species?: string;
  breed?: string;
  color?: string;
  microchip?: string;
  neutered?: boolean;
  owner_id?: string;
  owner_name?: string;
  owner_cpf_last4?: string;
  owner_phone?: string;
  owner_email?: string;
  created_at: string;
  // clinical context (human only)
  medications?: string;
  smoking?: string;
  alcohol?: string;
  diet_type?: string;
  physical_activity?: string;
  family_history?: string;
}

/** @deprecated use Subject */
export type Patient = Subject;

export interface Alert {
  marker: string;
  value: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface Recommendation {
  type: 'medication' | 'procedure' | 'referral' | 'diet' | 'habit' | 'supplement' | 'activity'
      | 'suggested_exam' | 'contextual_factor';
  description: string;
  priority: 'low' | 'medium' | 'high';
  // medication (therapeutic) and supplement (nutrition) extended fields
  name?: string;
  dose?: string;
  frequency?: string;
  duration?: string;
  _exam?: string;
  _rationale?: string;
}

export interface PrescriptionItem {
  name: string;
  dose: string | null;
  frequency: string;
  duration: string | null;
  notes: string;
}

export interface Prescription {
  id: string;
  exam_id: string;
  subject_id: string;
  agent_type: 'therapeutic' | 'nutrition';
  items: PrescriptionItem[];
  notes: string | null;
  pdf_url: string | null;
  created_at: string;
  created_by_email?: string;
  exam_created_at?: string;
}

export interface ClinicProfile {
  id: string;
  name: string;
  module: 'human' | 'veterinary';
  cnpj: string | null;
  clinic_logo_url: string | null;
}

export interface ImagingFinding {
  id: number;
  label: string;
  box?: [number, number, number, number];
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface ImagingMetadata {
  original_image_url?: string;
  findings: ImagingFinding[];
  measurements?: {
    rate?: string;
    pr_interval?: string;
    qrs_duration?: string;
    qt_interval?: string;
    axis?: string;
  } | null;
}

export interface ClinicalResult {
  agent_type: string;
  interpretation: string;
  risk_scores: Record<string, string>;
  alerts: Alert[];
  recommendations: Recommendation[];
  disclaimer: string;
  metadata?: ImagingMetadata;
}

export interface Exam {
  id: string;
  subject_id?: string;
  /** @deprecated use subject_id */
  patient_id?: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  source: string;
  file_path: string;
  file_type?: 'pdf' | 'dicom' | 'image' | 'unknown';
  error_message?: string | null;
  created_at: string;
  updated_at: string;
  results: ClinicalResult[] | null;
  review_status?: 'pending' | 'viewed' | 'reviewed';
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  max_severity_score?: number;
}

export interface ReviewQueueItem extends Exam {
  review_status: 'pending' | 'viewed' | 'reviewed';
  max_severity_score: number;
}

export interface User {
  id: string;
  email: string;
  role: 'admin';
  specialty?: string;
  created_at: string;
}

export interface JwtPayload {
  user_id: string;
  tenant_id: string;
  role: 'admin' | 'master';
  module: 'human' | 'veterinary';
}

export interface Connector {
  id: string;
  name: string;
  mode: 'swagger' | 'hl7' | 'file_drop';
  field_map: Record<string, string>;
  status: 'active' | 'inactive' | 'error';
  last_sync_at: string | null;
  sync_count: number;
  error_msg: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectorLog {
  id: string;
  event_type: 'ingest' | 'test' | 'error';
  status: 'success' | 'error';
  records_in: number;
  records_out: number;
  error_detail: string | null;
  duration_ms: number;
  created_at: string;
}

export interface SwaggerParseResult {
  fields: string[];
}

export interface AnimalSearchResult {
  id: string;
  name: string;
  sex: string;
  species: 'dog' | 'cat' | 'equine' | 'bovine';
  created_at: string;
}

export const HUMAN_SPECIALTIES: { value: string; label: string }[] = [
  { value: 'endocrinologia',    label: 'Endocrinologia' },
  { value: 'cardiologia',       label: 'Cardiologia' },
  { value: 'hematologia',       label: 'Hematologia' },
  { value: 'clínica_geral',     label: 'Clínica Geral' },
  { value: 'nutrição',          label: 'Nutrição' },
  { value: 'nefrologia',        label: 'Nefrologia' },
  { value: 'hepatologia',       label: 'Hepatologia' },
  { value: 'gastroenterologia', label: 'Gastroenterologia' },
  { value: 'ginecologia',       label: 'Ginecologia' },
  { value: 'urologia',          label: 'Urologia' },
  { value: 'pediatria',         label: 'Pediatria' },
  { value: 'neurologia',        label: 'Neurologia' },
  { value: 'ortopedia',         label: 'Ortopedia' },
  { value: 'pneumologia',       label: 'Pneumologia' },
  { value: 'reumatologia',      label: 'Reumatologia' },
  { value: 'oncologia',         label: 'Oncologia' },
  { value: 'infectologia',      label: 'Infectologia' },
  { value: 'dermatologia',      label: 'Dermatologia' },
  { value: 'psiquiatria',       label: 'Psiquiatria' },
  { value: 'geriatria',         label: 'Geriatria' },
  { value: 'medicina_esporte',  label: 'Medicina do Esporte' },
];

export const SPECIALTY_AGENTS: Record<string, string[]> = {
  clínica_geral:      ['metabolic', 'cardiovascular', 'hematology'],
  geriatria:          ['metabolic', 'cardiovascular', 'hematology'],
  medicina_esporte:   ['metabolic', 'cardiovascular', 'hematology'],
  endocrinologia:     ['metabolic'],
  nutrição:           ['metabolic'],
  dermatologia:       ['metabolic'],
  psiquiatria:        ['metabolic'],
  cardiologia:        ['cardiovascular'],
  pneumologia:        ['cardiovascular', 'hematology'],
  hematologia:        ['hematology'],
  oncologia:          ['hematology'],
  infectologia:       ['hematology'],
  pediatria:          ['metabolic', 'hematology'],
  neurologia:         ['metabolic', 'hematology'],
  nefrologia:         ['metabolic', 'hematology'],
  hepatologia:        ['metabolic', 'hematology'],
  gastroenterologia:  ['metabolic', 'hematology'],
  ginecologia:        ['metabolic', 'hematology'],
  urologia:           ['metabolic', 'hematology'],
  ortopedia:          ['metabolic', 'hematology'],
  reumatologia:       ['metabolic', 'hematology'],
};
