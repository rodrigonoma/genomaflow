export interface Patient {
  id: string;
  name: string;
  sex: string;
  birth_date: string;
  cpf_hash?: string;
  created_at: string;
}

export interface Alert {
  marker: string;
  value: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ClinicalResult {
  agent_type: string;
  interpretation: string;
  risk_scores: Record<string, string>;
  alerts: Alert[];
  disclaimer: string;
}

export interface Exam {
  id: string;
  patient_id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  source: string;
  file_path: string;
  created_at: string;
  updated_at: string;
  results: ClinicalResult[] | null;
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
}
