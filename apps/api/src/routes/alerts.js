const { withTenant } = require('../db/tenant');

module.exports = async function (fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    const { patient_id, severity } = request.query;

    return withTenant(fastify.pg, tenant_id, async (client) => {
      let query = `
        SELECT cr.alerts, cr.agent_type, cr.created_at,
               e.subject_id, p.name AS patient_name, cr.exam_id
        FROM clinical_results cr
        JOIN exams e ON e.id = cr.exam_id
        JOIN subjects p ON p.id = e.subject_id
        WHERE cr.tenant_id = $1
      `;
      const params = [tenant_id];

      if (patient_id) {
        params.push(patient_id);
        query += ` AND e.subject_id = $${params.length}`;
      }

      query += ' ORDER BY cr.created_at DESC LIMIT 100';
      const { rows } = await client.query(query, params);

      return rows
        .flatMap(row =>
          (row.alerts || []).map(alert => ({
            ...alert,
            exam_id: row.exam_id,
            patient_id: row.subject_id,
            patient_name: row.patient_name,
            agent_type: row.agent_type,
            created_at: row.created_at
          }))
        )
        .filter(a => !severity || a.severity === severity);
    });
  });
};
