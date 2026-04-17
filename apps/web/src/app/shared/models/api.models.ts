export interface Subject {
  id: string;
  name: string;
  sex: string;
  subject_type: 'human' | 'animal';
  birth_date?: string;
  cpf_hash?: string;
  species?: 'dog' | 'cat' | 'equine' | 'bovine';
  owner_cpf_hash?: string;
  created_at: string;
}

/** @deprecated use Subject */
export type Patient = Subject;

export interface Alert {
  marker: string;
  value: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface Recommendation {
  type: 'medication' | 'procedure' | 'referral' | 'diet' | 'habit' | 'supplement' | 'activity';
  description: string;
  priority: 'low' | 'medium' | 'high';
}

export interface ClinicalResult {
  agent_type: string;
  interpretation: string;
  risk_scores: Record<string, string>;
  alerts: Alert[];
  recommendations: Recommendation[];
  disclaimer: string;
}

export interface Exam {
  id: string;
  subject_id?: string;
  /** @deprecated use subject_id */
  patient_id?: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  source: string;
  file_path: string;
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
  role: 'doctor' | 'lab_tech' | 'admin';
  created_at: string;
}

export interface JwtPayload {
  user_id: string;
  tenant_id: string;
  role: 'doctor' | 'lab_tech' | 'admin';
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
