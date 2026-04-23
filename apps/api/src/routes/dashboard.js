const { withTenant } = require('../db/tenant');

const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
const ALERT_SEVERITY_THRESHOLD = 2; // medium+

function topSeverity(alerts) {
  if (!Array.isArray(alerts) || !alerts.length) return 'none';
  let top = 'none';
  for (const a of alerts) {
    const s = (a?.severity || '').toLowerCase();
    if ((SEV_RANK[s] ?? 0) > (SEV_RANK[top] ?? 0)) top = s;
  }
  return top;
}

module.exports = async function (fastify) {

  fastify.get('/insights', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;

    const { exams, subjectCount } = await withTenant(fastify.pg, tenant_id, async (client) => {
      // Exames (done) com resultados + nome do paciente
      const { rows: examRows } = await client.query(
        `SELECT e.id, e.subject_id, e.status, e.review_status, e.file_type, e.created_at,
                s.name AS subject_name, s.subject_type,
                json_agg(
                  json_build_object(
                    'agent_type', cr.agent_type,
                    'alerts', cr.alerts
                  )
                ) FILTER (WHERE cr.id IS NOT NULL) AS results
         FROM exams e
         JOIN subjects s ON s.id = e.subject_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
         LEFT JOIN clinical_results cr ON cr.exam_id = e.id AND cr.tenant_id = $1
         WHERE e.tenant_id = $1 AND e.status IN ('done')
         GROUP BY e.id, e.subject_id, e.status, e.review_status, e.file_type, e.created_at,
                  s.name, s.subject_type
         ORDER BY e.created_at DESC`,
        [tenant_id]
      );

      // Count de pacientes ativos (para % de alteração)
      const { rows: subjectRows } = await client.query(
        `SELECT COUNT(*)::int AS c FROM subjects WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenant_id]
      );

      return { exams: examRows, subjectCount: subjectRows[0].c };
    });

    // ── Alertas recentes (severity medium+) ─────────────────────────────
    const THIRTY_DAYS_AGO = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentAlerts = [];
    for (const e of exams) {
      if (new Date(e.created_at).getTime() < THIRTY_DAYS_AGO) continue;
      for (const r of (e.results || [])) {
        for (const a of (r.alerts || [])) {
          const rank = SEV_RANK[(a.severity || '').toLowerCase()] ?? 0;
          if (rank >= ALERT_SEVERITY_THRESHOLD) {
            recentAlerts.push({
              marker: a.marker,
              value: a.value,
              severity: a.severity,
              agent_type: r.agent_type,
              exam_id: e.id,
              exam_date: e.created_at,
              subject_id: e.subject_id,
              subject_name: e.subject_name,
            });
          }
        }
      }
    }
    recentAlerts.sort((a, b) => {
      const sevDiff = (SEV_RANK[(b.severity || '').toLowerCase()] ?? 0) - (SEV_RANK[(a.severity || '').toLowerCase()] ?? 0);
      if (sevDiff !== 0) return sevDiff;
      return new Date(b.exam_date).getTime() - new Date(a.exam_date).getTime();
    });
    const criticalAlertsRecent = recentAlerts.slice(0, 10);

    // ── Exames aguardando revisão (pending/viewed) ──────────────────────
    const reviewPending = exams
      .filter(e => e.review_status && e.review_status !== 'reviewed')
      .slice(0, 10)
      .map(e => ({
        exam_id: e.id,
        exam_date: e.created_at,
        review_status: e.review_status,
        subject_id: e.subject_id,
        subject_name: e.subject_name,
        file_type: e.file_type,
      }));

    // ── Último exame por paciente (para agregações) ─────────────────────
    const latestByPatient = new Map();
    for (const e of exams) {
      if (!latestByPatient.has(e.subject_id)) {
        latestByPatient.set(e.subject_id, e);
      }
    }

    // ── Top marcadores alterados na carteira ───────────────────────────
    const markerCounts = new Map();
    for (const e of latestByPatient.values()) {
      const seen = new Set();
      for (const r of (e.results || [])) {
        for (const a of (r.alerts || [])) {
          const rank = SEV_RANK[(a.severity || '').toLowerCase()] ?? 0;
          if (rank >= ALERT_SEVERITY_THRESHOLD && a.marker && !seen.has(a.marker)) {
            seen.add(a.marker);
            markerCounts.set(a.marker, (markerCounts.get(a.marker) ?? 0) + 1);
          }
        }
      }
    }
    const patientsWithLatest = latestByPatient.size || 1;
    const topMarkersAltered = [...markerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([marker, count]) => ({
        marker,
        count,
        pct: Math.round((count / patientsWithLatest) * 100),
      }));

    // ── Distribuição de risco da carteira ──────────────────────────────
    const riskDist = { critical: 0, high: 0, medium: 0, low: 0, none: 0 };
    for (const e of latestByPatient.values()) {
      let top = 'none';
      for (const r of (e.results || [])) {
        const t = topSeverity(r.alerts);
        if ((SEV_RANK[t] ?? 0) > (SEV_RANK[top] ?? 0)) top = t;
      }
      riskDist[top] = (riskDist[top] ?? 0) + 1;
    }

    return {
      critical_alerts_recent: criticalAlertsRecent,
      review_pending: reviewPending,
      top_markers_altered: topMarkersAltered,
      risk_distribution: riskDist,
      patients_with_latest_exam: latestByPatient.size,
      total_patients: subjectCount,
    };
  });
};
