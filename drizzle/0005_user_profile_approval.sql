-- ============================================================================
-- 0005_user_profile_approval.sql — User profile fields + registration approval
--
-- * teams / designations: admin-managed lookup lists picked at registration.
-- * users.status: self-registered accounts start PENDING and cannot sign in
--   until an admin approves them. Existing rows default to ACTIVE so nobody
--   who could log in before this migration is locked out.
-- * team_id / designation_id are nullable: required for new users at the API
--   layer, but pre-existing users have no value until an admin sets one.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE documentation.user_status AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS documentation.teams (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_name_unique
  ON documentation.teams (lower(name));

CREATE TABLE IF NOT EXISTS documentation.designations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS designations_name_unique
  ON documentation.designations (lower(name));

ALTER TABLE documentation.users
  ADD COLUMN IF NOT EXISTS status documentation.user_status NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS team_id UUID
    REFERENCES documentation.teams(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS designation_id UUID
    REFERENCES documentation.designations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approved_by UUID
    REFERENCES documentation.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_status_idx ON documentation.users (status);
CREATE INDEX IF NOT EXISTS users_team_idx ON documentation.users (team_id);
CREATE INDEX IF NOT EXISTS users_designation_idx ON documentation.users (designation_id);
