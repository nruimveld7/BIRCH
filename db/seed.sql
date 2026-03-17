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

-- Optional starter chart when no data exists.
IF NOT EXISTS (SELECT 1 FROM dbo.Charts WHERE DeletedAt IS NULL)
BEGIN
    INSERT INTO dbo.Charts (Name, PlaceholderThemeJson)
    VALUES (
        N'Example Chart',
        N'{"dark":{"background":"#07080b","text":"#ffffff","accent":"#c8102e","pageBorderColor":"#292a30","primaryGradient1":"#7a1b2c","primaryGradient2":"#2d1118","secondaryGradient1":"#361219","secondaryGradient2":"#0c0e12","canvasColor":"#0b0d12","canvasAccent":"#c8102e","nodeBackground":"#161a22","nodeBorder":"#292a30","nodeConnections":"#c8102e","nodeText":"#ffffff","placeholder":"#c8102e"},"light":{"background":"#f2f3f5","text":"#000000","accent":"#c8102e","pageBorderColor":"#bbbec6","primaryGradient1":"#f4d7dd","primaryGradient2":"#f8f9fb","secondaryGradient1":"#faeef0","secondaryGradient2":"#f5f6f8","canvasColor":"#edf0f4","canvasAccent":"#c8102e","nodeBackground":"#f5f6f8","nodeBorder":"#bbbec6","nodeConnections":"#c8102e","nodeText":"#000000","placeholder":"#c8102e"}}'
    );
END;
