# Documentation Platform — System Documentation

Welcome to the internal system documentation directory for the Documentation Platform codebase.

## Documentation Index

- **[System Architecture & Documentation Manual](./system_documentation.md)**:
  Detailed end-to-end specification covering:
  - System Overview & Core Philosophy
  - Complete Tech Stack & Component Hierarchy
  - Database Schema (PostgreSQL `documentation` schema, `ltree`, GIN full-text index)
  - Navigation Tree Subsystem (Materialized paths, fractional indexing, cycle detection, move transactions)
  - Document Management (Dual-state drafts vs. published revisions, autosave, conflict resolution, versioning)
  - Rich-Text Editor (Tiptap v3 architecture, bubble menu, slash commands, custom blocks)
  - Authentication, RBAC security matrix, and service layer permissions
  - Full-Text Search, Media handling, and Audit Logging
  - Complete API Route Reference & Operations Runbook

## Quick References

- Main Repository README: [../README.md](../README.md)
- Architectural Specification (v2): [../documentation_platform_architecture_v2.md](../documentation_platform_architecture_v2.md)
