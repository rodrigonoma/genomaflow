/**
 * Modelos pra feature de agendamento.
 * Espelham o schema da migration 053 + retornos da API /agenda.
 */

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'blocked';

export interface Appointment {
  id: string;
  tenant_id: string;
  user_id: string;
  subject_id: string | null;
  series_id: string | null;
  start_at: string;          // ISO string
  duration_minutes: number;
  status: AppointmentStatus;
  reason: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  // Enriched client-side ao listar (lookup de subjects):
  subject_name?: string;
}

export interface ScheduleSettings {
  user_id: string;
  tenant_id: string;
  default_slot_minutes: number;       // 30, 45, 60, 75, 90, 105, 120
  business_hours: BusinessHours;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export type BusinessHours = Record<DayKey, [string, string][]>;

export interface FreeSlot {
  start_at: string;
  duration_minutes: number;
}

export const VALID_SLOT_MINUTES = [30, 45, 60, 75, 90, 105, 120] as const;
export type ValidSlotMinutes = typeof VALID_SLOT_MINUTES[number];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Segunda',
  tue: 'Terça',
  wed: 'Quarta',
  thu: 'Quinta',
  fri: 'Sexta',
  sat: 'Sábado',
  sun: 'Domingo',
};

export const DAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Faltou',
  blocked: 'Bloqueado',
};

export const STATUS_COLORS: Record<AppointmentStatus, { bg: string; border: string; text: string }> = {
  scheduled: { bg: 'rgba(73, 75, 214, 0.18)',  border: '#494bd6', text: '#dae2fd' },
  confirmed: { bg: 'rgba(34, 197, 94, 0.18)',  border: '#22c55e', text: '#d4f4dd' },
  completed: { bg: 'rgba(120, 120, 140, 0.20)', border: '#7c7b8f', text: '#a09fb2' },
  cancelled: { bg: 'rgba(239, 68, 68, 0.10)',   border: '#ef4444', text: '#fca5a5' },
  no_show:   { bg: 'rgba(251, 146, 60, 0.20)',  border: '#fb923c', text: '#fed7aa' },
  blocked:   { bg: 'rgba(70, 69, 84, 0.30)',    border: '#464554', text: '#908fa0' },
};
