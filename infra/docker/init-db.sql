-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create application roles for RLS
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'contextinject_api') THEN
    CREATE ROLE contextinject_api;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'contextinject_worker') THEN
    CREATE ROLE contextinject_worker;
  END IF;
END
$$;

GRANT contextinject_api TO contextinject;
GRANT contextinject_worker TO contextinject;
