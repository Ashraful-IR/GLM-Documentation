-- Migration 0003: Import jobs & import job items
-- Supports the two-phase (analyze → commit) markdown import pipeline.

CREATE TABLE IF NOT EXISTS documentation.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_filename TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PARSED','COMMITTED','FAILED')),
  strategy_used TEXT NOT NULL,
  raw_markdown TEXT NOT NULL,
  parent_navigation_id UUID REFERENCES documentation.navigation(id),
  warnings JSONB DEFAULT '[]',
  created_by UUID NOT NULL REFERENCES documentation.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  committed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS documentation.import_job_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id UUID NOT NULL REFERENCES documentation.import_jobs(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documentation.documents(id),
  navigation_id UUID REFERENCES documentation.navigation(id),
  section_title TEXT NOT NULL,
  section_hash TEXT NOT NULL,
  order_index INT NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS import_jobs_created_by_idx ON documentation.import_jobs(created_by);
CREATE INDEX IF NOT EXISTS import_job_items_job_idx ON documentation.import_job_items(import_job_id);
CREATE INDEX IF NOT EXISTS import_job_items_doc_idx ON documentation.import_job_items(document_id);
