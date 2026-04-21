-- Migrate all doctor and lab_tech users to admin role
-- From this point, the only valid role is 'admin' (and 'master' for superusers)
UPDATE users SET role = 'admin' WHERE role IN ('doctor', 'lab_tech');
