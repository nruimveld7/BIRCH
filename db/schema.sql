/*
  Equipment Lifecycle Manager (ELM)
  Baseline schema (starter).

  This intentionally starts from a clean baseline.
  Add domain tables incrementally as ELM requirements are defined.
*/

SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.SchemaInfo', N'U') IS NULL
BEGIN
	CREATE TABLE dbo.SchemaInfo (
		SchemaVersion INT NOT NULL CONSTRAINT PK_SchemaInfo PRIMARY KEY,
		AppliedAt DATETIME2(0) NOT NULL CONSTRAINT DF_SchemaInfo_AppliedAt DEFAULT SYSUTCDATETIME(),
		Notes NVARCHAR(300) NULL
	);
END;

IF NOT EXISTS (SELECT 1 FROM dbo.SchemaInfo WHERE SchemaVersion = 1)
BEGIN
	INSERT INTO dbo.SchemaInfo (SchemaVersion, Notes)
	VALUES (1, N'ELM baseline schema initialized.');
END;
