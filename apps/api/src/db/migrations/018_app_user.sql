-- Create a non-superuser role for the application so RLS policies are enforced.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'genomaflow_app') THEN
    CREATE ROLE genomaflow_app LOGIN PASSWORD 'genomaflow_app_2026';
  END IF;
END$$;

GRANT CONNECT ON DATABASE genomaflow TO genomaflow_app;
GRANT USAGE ON SCHEMA public TO genomaflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO genomaflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO genomaflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO genomaflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO genomaflow_app;
