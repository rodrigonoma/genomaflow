ALTER TABLE exams
  ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'viewed', 'reviewed')),
  ADD COLUMN reviewed_by UUID REFERENCES users(id),
  ADD COLUMN reviewed_at TIMESTAMPTZ;

CREATE TABLE review_audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exam_id     UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  from_status TEXT NOT NULL,
  to_status   TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE review_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON review_audit_log
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
