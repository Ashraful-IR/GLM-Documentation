-- ============================================================================
-- 0003_import_jobs.sql — Structured Markdown Import Job Tracking
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_status') THEN
    CREATE TYPE documentation.import_status AS ENUM ('ANALYZED', 'COMMITTED', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS documentation.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_filename TEXT NOT NULL,
  status documentation.import_status NOT NULL DEFAULT 'ANALYZED',
  strategy_used TEXT NOT NULL,
  raw_markdown TEXT NOT NULL,
  parent_navigation_id UUID REFERENCES documentation.navigation(id) ON DELETE SET NULL,
  target_folder_id UUID REFERENCES documentation.navigation(id) ON DELETE SET NULL,
  total_sections INT NOT NULL DEFAULT 0,
  imported_sections INT NOT NULL DEFAULT 0,
  auto_published BOOLEAN NOT NULL DEFAULT true,
  warnings JSONB DEFAULT '[]'::jsonb,
  created_by UUID NOT NULL REFERENCES documentation.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS documentation.import_job_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id UUID NOT NULL REFERENCES documentation.import_jobs(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documentation.documents(id) ON DELETE SET NULL,
  navigation_id UUID REFERENCES documentation.navigation(id) ON DELETE SET NULL,
  section_title TEXT NOT NULL,
  section_slug TEXT NOT NULL,
  section_hash TEXT NOT NULL,
  order_index INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUCCESS'
);

CREATE INDEX IF NOT EXISTS import_jobs_created_by_idx ON documentation.import_jobs (created_by);
CREATE INDEX IF NOT EXISTS import_jobs_created_at_idx ON documentation.import_jobs (created_at);
CREATE INDEX IF NOT EXISTS import_job_items_job_id_idx ON documentation.import_job_items (import_job_id);
CREATE INDEX IF NOT EXISTS import_job_items_hash_idx ON documentation.import_job_items (section_hash);
