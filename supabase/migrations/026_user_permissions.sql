-- Add permissions column to profiles table to support fine-grained access control
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb;

-- Typical initial mapping for existing roles, though ADMIN always bypasses checks.
-- STAFF could be set to null/empty so they have no permissions by default.
UPDATE profiles 
SET permissions = '{
  "customers": { "view": true, "create": true, "edit": true, "delete": false },
  "packages": { "view": true, "create": true, "edit": false, "delete": false },
  "reports": { "view": true, "export": true },
  "staff": { "view": false, "create": false, "edit": false, "delete": false },
  "settings": { "view": false, "edit": false }
}'::jsonb
WHERE role = 'CASHIER';

UPDATE profiles 
SET permissions = '{
  "customers": { "view": true, "create": false, "edit": false, "delete": false },
  "packages": { "view": true, "create": false, "edit": false, "delete": false },
  "reports": { "view": false, "export": false },
  "staff": { "view": false, "create": false, "edit": false, "delete": false },
  "settings": { "view": false, "edit": false }
}'::jsonb
WHERE role = 'GATE_KEEPER';

-- Notify supabase to reload schema caching for PostgREST
NOTIFY pgrst, 'reload schema';
