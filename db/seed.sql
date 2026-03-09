SET QUOTED_IDENTIFIER ON;

-- Seed roles (idempotent)
MERGE dbo.Roles AS target
USING (
    SELECT v.RoleName, v.RoleRank
    FROM (VALUES
        (N'Member', 1),
        (N'Maintainer', 2),
        (N'Manager', 3)
    ) AS v(RoleName, RoleRank)
) AS source
ON target.RoleName = source.RoleName
WHEN MATCHED THEN UPDATE SET RoleRank = source.RoleRank
WHEN NOT MATCHED THEN INSERT (RoleName, RoleRank) VALUES (source.RoleName, source.RoleRank);

-- Optional starter hierarchy when no data exists.
IF NOT EXISTS (SELECT 1 FROM dbo.Hierarchies WHERE DeletedAt IS NULL)
BEGIN
    INSERT INTO dbo.Hierarchies (Name, PlaceholderThemeJson)
    VALUES (
        N'Example Hierarchy',
        N'{"dark":{"placeholder":"#c8102e"},"light":{"placeholder":"#c8102e"}}'
    );
END;
