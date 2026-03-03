/*
  ELM seed script (starter).
  Add deterministic sample data when core tables are defined.
*/

SET NOCOUNT ON;

SELECT SchemaVersion, AppliedAt, Notes
FROM dbo.SchemaInfo
ORDER BY SchemaVersion;
