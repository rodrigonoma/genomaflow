-- Normalize all existing emails to lowercase
UPDATE users SET email = LOWER(email) WHERE email != LOWER(email);
