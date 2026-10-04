-- ============================================================================
-- 0004_drop_content_text_btree.sql — Remove the oversized-value B-tree index
--
-- 0002_scalability_indexes.sql created a plain B-tree index on
-- documentation.documents (content_text). B-tree index rows must fit within
-- 1/3 of a page (2704 bytes on an 8KB-page cluster), so INSERT/UPDATE of any
-- document whose plain-text mirror exceeds that fails with SQLSTATE 54000:
--
--   index row size 2808 exceeds btree version 4 maximum 2704
--   for index "documents_content_text_idx"
--
-- The index serves no query in the app: full-text search (search.service.ts)
-- uses to_tsvector(...) @@ plainto_tsquery(...), which is served by the GIN
-- index documents_search_idx from 0000_init.sql. GIN/full-text indexing has
-- no per-row size limit of this kind (it is also what PostgreSQL's own error
-- hint recommends for values this large).
-- ============================================================================

DROP INDEX IF EXISTS documentation.documents_content_text_idx;
