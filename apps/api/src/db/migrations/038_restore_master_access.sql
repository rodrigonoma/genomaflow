-- Migration 038: Restore master user access.
-- Reset master password hash and ensure email is correct.
UPDATE users
SET password_hash = '$2b$12$a9.yK.x7Voh7YqUYzK1g8.AJ8nVHm23ADk8lJNZfsANKAnMyYSLFS',
    email = 'rodrigonoma@genomaflow.com.br',
    active = true
WHERE role = 'master';
