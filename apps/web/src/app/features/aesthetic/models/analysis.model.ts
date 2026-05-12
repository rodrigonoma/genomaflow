/**
 * Modelos TypeScript para a feature estética (F1 — Facial Analysis).
 * Espelham o schema das migrations 088/089/090 e os contratos REST de
 * /api/aesthetic (consent, photos, analyses).
 * Spec: docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md §4-6
 */

// ---------------------------------------------------------------------------
// Enums / unions
// ---------------------------------------------------------------------------

export type AnalysisType =
  | 'facial'
  | 'eyelids'
  | 'neck'
  | 'breast'
  | 'arms'
  | 'abdomen'
  | 'legs'
  | 'glutes'
  | 'full_body'
  | 'other';

export type AnalysisStatus = 'pending' | 'processing' | 'done' | 'error';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

// ---------------------------------------------------------------------------
// Region discriminated union
// ---------------------------------------------------------------------------

export interface RegionBbox {
  type: 'bbox';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionPolyline {
  type: 'polyline';
  points: Array<{ x: number; y: number }>;
}

export interface RegionPolygon {
  type: 'polygon';
  points: Array<{ x: number; y: number }>;
}

export interface RegionLine {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RegionPoint {
  type: 'point';
  x: number;
  y: number;
}

export type Region =
  | RegionBbox
  | RegionPolyline
  | RegionPolygon
  | RegionLine
  | RegionPoint;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface MetricData {
  score: number;
  confidence: ConfidenceLevel;
  regions: Region[];
}

/** Mapa nome-da-métrica → dados da métrica */
export type Metrics = Record<string, MetricData>;

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/**
 * Backend `GET /aesthetic/consent/:subject_id` retorna SEMPRE 200 com:
 *   - `{ confirmed: false }` quando NÃO há consent (todos demais campos undefined).
 *   - `{ confirmed: true, id, created_at, reinforced_regions }` quando há.
 *
 * Frontend DEVE checar `confirmed` antes de tratar como válido — checar
 * truthy do objeto NÃO basta (regressão 2026-05-12 fez upload de fotos
 * sem consent porque `{confirmed:false}` é truthy).
 */
export interface AestheticConsent {
  confirmed: boolean;
  id?: string;
  tenant_id?: string;
  subject_id?: string;
  user_id?: string;
  consented_at?: string;
  notes?: string | null;
  reinforced_regions?: string[] | null;
  revoked_at?: string | null;
  created_at?: string;
}

export interface CreateConsentPayload {
  subject_id: string;
  notes?: string;
  reinforced_regions?: string[];
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export interface AestheticPhoto {
  id: string;
  tenant_id: string;
  subject_id: string;
  user_id: string;
  photo_type: string;
  s3_key: string;
  is_sensitive: boolean;
  taken_at: string;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface PhotoUrlResponse {
  url: string;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------

export interface AestheticAnalysisListItem {
  id: string;
  tenant_id: string;
  subject_id: string;
  user_id: string;
  analysis_type: AnalysisType;
  photo_ids: string[];
  status: AnalysisStatus;
  model_metrics: string | null;
  model_recommendations: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  error_code: string | null;
  error_message: string | null;
  baseline_analysis_id: string | null;
  credits_charged: number;
  credits_refunded: boolean;
  deleted_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface AestheticAnalysisDetail extends AestheticAnalysisListItem {
  metrics: Metrics | null;
  observations: Record<string, unknown> | null;
  recommendations: Record<string, unknown> | null;
}

export interface CreateAnalysisPayload {
  analysis_type: AnalysisType;
  subject_id: string;
  photo_ids: string[];
  baseline_id?: string;
}

export interface ListAnalysesParams {
  subject_id: string;
  type?: AnalysisType;
  limit?: number;
  offset?: number;
}

export interface ListAnalysesResponse {
  items: AestheticAnalysisListItem[];
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export interface CompareResult {
  baseline_id: string;
  current_id: string;
  deltas: Record<string, number>;
  overall_change: number;
}
