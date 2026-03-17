SET QUOTED_IDENTIFIER ON;

-- Remove legacy schedule-domain tables.
IF OBJECT_ID('dbo.ScheduleEvents', 'U') IS NOT NULL DROP TABLE dbo.ScheduleEvents;
IF OBJECT_ID('dbo.ScheduleAssignments', 'U') IS NOT NULL DROP TABLE dbo.ScheduleAssignments;
IF OBJECT_ID('dbo.ScheduleUsers', 'U') IS NOT NULL DROP TABLE dbo.ScheduleUsers;
IF OBJECT_ID('dbo.EventCodes', 'U') IS NOT NULL DROP TABLE dbo.EventCodes;
IF OBJECT_ID('dbo.ScheduleAssignmentOrders', 'U') IS NOT NULL DROP TABLE dbo.ScheduleAssignmentOrders;
IF OBJECT_ID('dbo.ScheduleShiftOrders', 'U') IS NOT NULL DROP TABLE dbo.ScheduleShiftOrders;
IF OBJECT_ID('dbo.ShiftEdits', 'U') IS NOT NULL DROP TABLE dbo.ShiftEdits;
IF OBJECT_ID('dbo.Shifts', 'U') IS NOT NULL DROP TABLE dbo.Shifts;
IF OBJECT_ID('dbo.Patterns', 'U') IS NOT NULL DROP TABLE dbo.Patterns;
IF OBJECT_ID('dbo.Schedules', 'U') IS NOT NULL DROP TABLE dbo.Schedules;

-- In-place legacy -> chart migration for existing dev databases.
IF OBJECT_ID('dbo.Charts', 'U') IS NULL AND OBJECT_ID('dbo.Hierarchies', 'U') IS NOT NULL
BEGIN
	EXEC sp_rename 'dbo.Hierarchies', 'Charts';
END;

IF OBJECT_ID('dbo.ChartUsers', 'U') IS NULL AND OBJECT_ID('dbo.HierarchyUsers', 'U') IS NOT NULL
BEGIN
	EXEC sp_rename 'dbo.HierarchyUsers', 'ChartUsers';
END;

IF COL_LENGTH('dbo.Users', 'DefaultChartId') IS NULL
	AND COL_LENGTH('dbo.Users', 'DefaultHierarchyId') IS NOT NULL
BEGIN
	EXEC sp_rename 'dbo.Users.DefaultHierarchyId', 'DefaultChartId', 'COLUMN';
END;

IF COL_LENGTH('dbo.Users', 'ChartUiStateJson') IS NULL
	AND COL_LENGTH('dbo.Users', 'HierarchyUiStateJson') IS NOT NULL
BEGIN
	EXEC sp_rename 'dbo.Users.HierarchyUiStateJson', 'ChartUiStateJson', 'COLUMN';
END;

IF COL_LENGTH('dbo.ChartUsers', 'ChartId') IS NULL
	AND COL_LENGTH('dbo.ChartUsers', 'HierarchyId') IS NOT NULL
BEGIN
	EXEC sp_rename 'dbo.ChartUsers.HierarchyId', 'ChartId', 'COLUMN';
END;

IF COL_LENGTH('dbo.Nodes', 'ChartId') IS NULL
	AND COL_LENGTH('dbo.Nodes', 'HierarchyId') IS NOT NULL
BEGIN
	EXEC sp_rename 'dbo.Nodes.HierarchyId', 'ChartId', 'COLUMN';
END;

IF COL_LENGTH('dbo.NodeConnections', 'ChartId') IS NULL
	AND COL_LENGTH('dbo.NodeConnections', 'HierarchyId') IS NOT NULL
BEGIN
	EXEC sp_rename 'dbo.NodeConnections.HierarchyId', 'ChartId', 'COLUMN';
END;

IF COL_LENGTH('dbo.UserSessions', 'ActiveChartId') IS NULL
	AND COL_LENGTH('dbo.UserSessions', 'ActiveHierarchyId') IS NOT NULL
BEGIN
	EXEC sp_rename 'dbo.UserSessions.ActiveHierarchyId', 'ActiveChartId', 'COLUMN';
END;

-- Core identity table.
IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        UserOid nvarchar(64) NOT NULL PRIMARY KEY,
        FullName nvarchar(200) NULL,
        DisplayName nvarchar(200) NULL,
        Email nvarchar(320) NULL,
        EntraFirstName nvarchar(100) NULL,
        EntraLastName nvarchar(100) NULL,
        OnboardingRole tinyint NOT NULL CONSTRAINT DF_Users_OnboardingRole DEFAULT 0,
        DefaultChartId int NULL,
        ChartUiStateJson nvarchar(max) NULL,
        IsActive bit NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT sysutcdatetime(),
        UpdatedAt datetime2 NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL
    );
END;

IF OBJECT_ID('dbo.CK_Users_OnboardingRole_Valid', 'C') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_OnboardingRole_Valid CHECK (OnboardingRole BETWEEN 0 AND 3);
END;

IF OBJECT_ID('dbo.CK_Users_ChartUiStateJson_IsJson', 'C') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_ChartUiStateJson_IsJson
    CHECK (ChartUiStateJson IS NULL OR ISJSON(ChartUiStateJson) = 1);
END;

-- Bootstrap managers remain for first-run setup semantics.
IF OBJECT_ID('dbo.BootstrapManagers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.BootstrapManagers (
        UserOid nvarchar(64) NOT NULL PRIMARY KEY,
        Source nvarchar(50) NOT NULL CONSTRAINT DF_BootstrapManagers_Source DEFAULT 'env',
        GrantedAt datetime2 NOT NULL CONSTRAINT DF_BootstrapManagers_GrantedAt DEFAULT sysutcdatetime(),
        IsActive bit NOT NULL CONSTRAINT DF_BootstrapManagers_IsActive DEFAULT 1,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT FK_BootstrapManagers_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid)
    );
END;

-- Fixed access levels.
IF OBJECT_ID('dbo.Roles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Roles (
        RoleId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        RoleName nvarchar(50) NOT NULL UNIQUE,
        RoleRank int NOT NULL
    );
END;

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
WHEN MATCHED THEN
    UPDATE SET RoleRank = source.RoleRank
WHEN NOT MATCHED THEN
    INSERT (RoleName, RoleRank) VALUES (source.RoleName, source.RoleRank);

-- Charts replace schedules.
IF OBJECT_ID('dbo.Charts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Charts (
        ChartId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Name nvarchar(200) NOT NULL,
        PlaceholderThemeJson nvarchar(max) NOT NULL,
        IsActive bit NOT NULL CONSTRAINT DF_Charts_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_Charts_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL
    );
END;

IF OBJECT_ID('dbo.CK_Charts_PlaceholderThemeJson_Valid', 'C') IS NULL
BEGIN
    ALTER TABLE dbo.Charts
    ADD CONSTRAINT CK_Charts_PlaceholderThemeJson_Valid CHECK (
        ISJSON(PlaceholderThemeJson) = 1
        AND JSON_VALUE(PlaceholderThemeJson, '$.dark.placeholder') IS NOT NULL
        AND JSON_VALUE(PlaceholderThemeJson, '$.light.placeholder') IS NOT NULL
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_Charts_Name_Active' AND object_id = OBJECT_ID('dbo.Charts')
)
BEGIN
    CREATE UNIQUE INDEX UX_Charts_Name_Active
        ON dbo.Charts(Name);
END;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Charts')
      AND name = 'UX_Charts_Name_Active'
      AND has_filter = 1
)
BEGIN
    DROP INDEX UX_Charts_Name_Active ON dbo.Charts;
    CREATE UNIQUE INDEX UX_Charts_Name_Active
        ON dbo.Charts(Name);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Users_DefaultChart' AND parent_object_id = OBJECT_ID('dbo.Users')
)
BEGIN
    ALTER TABLE dbo.Users WITH CHECK
    ADD CONSTRAINT FK_Users_DefaultChart FOREIGN KEY (DefaultChartId) REFERENCES dbo.Charts(ChartId);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_Users_DefaultChartId' AND object_id = OBJECT_ID('dbo.Users')
)
BEGIN
    CREATE INDEX IX_Users_DefaultChartId ON dbo.Users(DefaultChartId);
END;

-- User membership to chart with role.
IF OBJECT_ID('dbo.ChartUsers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ChartUsers (
        ChartUserId bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ChartId int NOT NULL,
        UserOid nvarchar(64) NOT NULL,
        RoleId int NOT NULL,
        GrantedAt datetime2 NOT NULL CONSTRAINT DF_ChartUsers_GrantedAt DEFAULT sysutcdatetime(),
        GrantedBy nvarchar(64) NULL,
        CONSTRAINT FK_ChartUsers_Charts FOREIGN KEY (ChartId) REFERENCES dbo.Charts(ChartId),
        CONSTRAINT FK_ChartUsers_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid),
        CONSTRAINT FK_ChartUsers_Roles FOREIGN KEY (RoleId) REFERENCES dbo.Roles(RoleId)
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_ChartUsers_Chart_User_Active' AND object_id = OBJECT_ID('dbo.ChartUsers')
)
BEGIN
    CREATE UNIQUE INDEX UX_ChartUsers_Chart_User_Active
        ON dbo.ChartUsers(ChartId, UserOid);
END;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.ChartUsers')
      AND name = 'UX_ChartUsers_Chart_User_Active'
      AND has_filter = 1
)
BEGIN
    DROP INDEX UX_ChartUsers_Chart_User_Active ON dbo.ChartUsers;
    CREATE UNIQUE INDEX UX_ChartUsers_Chart_User_Active
        ON dbo.ChartUsers(ChartId, UserOid);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_ChartUsers_UserOid' AND object_id = OBJECT_ID('dbo.ChartUsers')
)
BEGIN
    CREATE INDEX IX_ChartUsers_UserOid ON dbo.ChartUsers(UserOid);
END;

-- Repair legacy split state where both chart and hierarchy tables exist simultaneously.
IF OBJECT_ID('dbo.Charts', 'U') IS NOT NULL AND OBJECT_ID('dbo.Hierarchies', 'U') IS NOT NULL
BEGIN
    IF EXISTS (
        SELECT 1
        FROM dbo.Hierarchies h
        INNER JOIN dbo.Charts c ON c.ChartId = h.HierarchyId
        WHERE ISNULL(c.Name, N'') <> ISNULL(h.Name, N'')
           OR ISNULL(c.PlaceholderThemeJson, N'') <> ISNULL(h.PlaceholderThemeJson, N'')
           OR ISNULL(c.IsActive, 0) <> ISNULL(h.IsActive, 0)
    )
    BEGIN
        THROW 51020, 'Legacy Charts/Hierarchies merge blocked due to conflicting ChartId values.', 1;
    END;

    IF EXISTS (
        SELECT 1
        FROM dbo.Hierarchies h
        INNER JOIN dbo.Charts c ON c.Name = h.Name
        WHERE c.ChartId <> h.HierarchyId
    )
    BEGIN
        THROW 51021, 'Legacy Charts/Hierarchies merge blocked due to conflicting chart names.', 1;
    END;

    SET IDENTITY_INSERT dbo.Charts ON;
    INSERT INTO dbo.Charts (
        ChartId,
        Name,
        PlaceholderThemeJson,
        IsActive,
        CreatedAt,
        CreatedBy,
        UpdatedAt,
        UpdatedBy,
        DeletedAt,
        DeletedBy
    )
    SELECT
        h.HierarchyId,
        h.Name,
        h.PlaceholderThemeJson,
        h.IsActive,
        h.CreatedAt,
        h.CreatedBy,
        h.UpdatedAt,
        h.UpdatedBy,
        h.DeletedAt,
        h.DeletedBy
    FROM dbo.Hierarchies h
    WHERE NOT EXISTS (
        SELECT 1
        FROM dbo.Charts c
        WHERE c.ChartId = h.HierarchyId
    );
    SET IDENTITY_INSERT dbo.Charts OFF;
END;

IF OBJECT_ID('dbo.ChartUsers', 'U') IS NOT NULL AND OBJECT_ID('dbo.HierarchyUsers', 'U') IS NOT NULL
BEGIN
    WITH RankedLegacyMemberships AS (
        SELECT
            hu.HierarchyId,
            hu.UserOid,
            hu.RoleId,
            hu.GrantedAt,
            hu.GrantedBy,
            hu.IsActive,
            hu.DeletedAt,
            hu.DeletedBy,
            ROW_NUMBER() OVER (
                PARTITION BY hu.HierarchyId, hu.UserOid
                ORDER BY
                    CASE WHEN hu.IsActive = 1 THEN 0 ELSE 1 END,
                    hu.GrantedAt DESC
            ) AS RowNum
        FROM dbo.HierarchyUsers hu
    )
    INSERT INTO dbo.ChartUsers (
        ChartId,
        UserOid,
        RoleId,
        GrantedAt,
        GrantedBy,
        IsActive,
        DeletedAt,
        DeletedBy
    )
    SELECT
        legacy.HierarchyId,
        legacy.UserOid,
        legacy.RoleId,
        legacy.GrantedAt,
        legacy.GrantedBy,
        legacy.IsActive,
        legacy.DeletedAt,
        legacy.DeletedBy
    FROM RankedLegacyMemberships legacy
    WHERE legacy.RowNum = 1
      AND EXISTS (
        SELECT 1
        FROM dbo.Charts c
        WHERE c.ChartId = legacy.HierarchyId
      )
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.ChartUsers cu
        WHERE cu.ChartId = legacy.HierarchyId
          AND cu.UserOid = legacy.UserOid
      );
END;

-- Remove graph/session rows that target a chart id that does not exist.
DELETE c
FROM dbo.NodeConnections c
LEFT JOIN dbo.Charts ch ON ch.ChartId = c.ChartId
LEFT JOIN dbo.Nodes sn ON sn.NodeId = c.SourceNodeId
LEFT JOIN dbo.Nodes tn ON tn.NodeId = c.TargetNodeId
WHERE ch.ChartId IS NULL
   OR sn.NodeId IS NULL
   OR tn.NodeId IS NULL
   OR sn.ChartId <> c.ChartId
   OR tn.ChartId <> c.ChartId;

DELETE nu
FROM dbo.NodeUsers nu
LEFT JOIN dbo.Nodes n ON n.NodeId = nu.NodeId
WHERE n.NodeId IS NULL;

DELETE n
FROM dbo.Nodes n
LEFT JOIN dbo.Charts ch ON ch.ChartId = n.ChartId
WHERE ch.ChartId IS NULL;

DELETE cu
FROM dbo.ChartUsers cu
LEFT JOIN dbo.Charts ch ON ch.ChartId = cu.ChartId
WHERE ch.ChartId IS NULL;

UPDATE dbo.Users
SET DefaultChartId = NULL,
    UpdatedAt = SYSUTCDATETIME()
WHERE DefaultChartId IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM dbo.Charts ch
      WHERE ch.ChartId = dbo.Users.DefaultChartId
  );

UPDATE dbo.UserSessions
SET ActiveChartId = NULL
WHERE ActiveChartId IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM dbo.Charts ch
      WHERE ch.ChartId = dbo.UserSessions.ActiveChartId
  );

IF OBJECT_ID('dbo.FK_Nodes_Hierarchies', 'F') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Nodes DROP CONSTRAINT FK_Nodes_Hierarchies;
END;

IF OBJECT_ID('dbo.FK_NodeConnections_Hierarchies', 'F') IS NOT NULL
BEGIN
    ALTER TABLE dbo.NodeConnections DROP CONSTRAINT FK_NodeConnections_Hierarchies;
END;

IF OBJECT_ID('dbo.FK_UserSessions_ActiveHierarchy', 'F') IS NOT NULL
BEGIN
    ALTER TABLE dbo.UserSessions DROP CONSTRAINT FK_UserSessions_ActiveHierarchy;
END;

IF OBJECT_ID('dbo.FK_Users_DefaultHierarchy', 'F') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Users DROP CONSTRAINT FK_Users_DefaultHierarchy;
END;

IF COL_LENGTH('dbo.Users', 'DefaultHierarchyId') IS NOT NULL
    AND COL_LENGTH('dbo.Users', 'DefaultChartId') IS NOT NULL
BEGIN
    DECLARE @MigrateDefaultChartSql nvarchar(max) = N'';

    IF EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID('dbo.Users')
          AND name = 'IX_Users_DefaultHierarchyId'
    )
    BEGIN
        DROP INDEX IX_Users_DefaultHierarchyId ON dbo.Users;
    END;

    SET @MigrateDefaultChartSql = N'
        UPDATE dbo.Users
        SET DefaultChartId = COALESCE(DefaultChartId, DefaultHierarchyId),
            UpdatedAt = CASE
                WHEN DefaultChartId IS NULL AND DefaultHierarchyId IS NOT NULL THEN SYSUTCDATETIME()
                ELSE UpdatedAt
            END;

        ALTER TABLE dbo.Users DROP COLUMN DefaultHierarchyId;
    ';
    EXEC sp_executesql @MigrateDefaultChartSql;
END;

IF COL_LENGTH('dbo.Users', 'HierarchyUiStateJson') IS NOT NULL
    AND COL_LENGTH('dbo.Users', 'ChartUiStateJson') IS NOT NULL
BEGIN
    DECLARE @MigrateChartUiSql nvarchar(max) = N'';

    IF OBJECT_ID('dbo.CK_Users_HierarchyUiStateJson_IsJson', 'C') IS NOT NULL
    BEGIN
        ALTER TABLE dbo.Users DROP CONSTRAINT CK_Users_HierarchyUiStateJson_IsJson;
    END;

    SET @MigrateChartUiSql = N'
        UPDATE dbo.Users
        SET ChartUiStateJson = COALESCE(ChartUiStateJson, HierarchyUiStateJson)
        WHERE ChartUiStateJson IS NULL
          AND HierarchyUiStateJson IS NOT NULL;

        ALTER TABLE dbo.Users DROP COLUMN HierarchyUiStateJson;
    ';
    EXEC sp_executesql @MigrateChartUiSql;
END;

IF OBJECT_ID('dbo.FK_Nodes_Charts', 'F') IS NULL
BEGIN
    ALTER TABLE dbo.Nodes WITH CHECK
    ADD CONSTRAINT FK_Nodes_Charts FOREIGN KEY (ChartId) REFERENCES dbo.Charts(ChartId);
END;

IF OBJECT_ID('dbo.FK_NodeConnections_Charts', 'F') IS NULL
BEGIN
    ALTER TABLE dbo.NodeConnections WITH CHECK
    ADD CONSTRAINT FK_NodeConnections_Charts FOREIGN KEY (ChartId) REFERENCES dbo.Charts(ChartId);
END;

IF OBJECT_ID('dbo.FK_UserSessions_ActiveChart', 'F') IS NULL
BEGIN
    ALTER TABLE dbo.UserSessions WITH CHECK
    ADD CONSTRAINT FK_UserSessions_ActiveChart FOREIGN KEY (ActiveChartId) REFERENCES dbo.Charts(ChartId);
END;

IF OBJECT_ID('dbo.HierarchyUsers', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.HierarchyUsers;
END;

IF OBJECT_ID('dbo.Hierarchies', 'U') IS NOT NULL
BEGIN
    DECLARE @DropHierarchyFkSql nvarchar(max) = N'';
    SELECT @DropHierarchyFkSql = STRING_AGG(
        N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(fk.parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(fk.parent_object_id))
        + N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';',
        N' '
    )
    FROM sys.foreign_keys fk
    WHERE fk.referenced_object_id = OBJECT_ID('dbo.Hierarchies');

    IF @DropHierarchyFkSql IS NOT NULL AND LEN(@DropHierarchyFkSql) > 0
    BEGIN
        EXEC sp_executesql @DropHierarchyFkSql;
    END;
END;

IF OBJECT_ID('dbo.Hierarchies', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.Hierarchies;
END;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Nodes')
      AND name = 'UX_Nodes_Hierarchy_NodeKey_Active'
)
BEGIN
    DROP INDEX UX_Nodes_Hierarchy_NodeKey_Active ON dbo.Nodes;
END;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Nodes')
      AND name = 'UX_Nodes_Hierarchy_LayerOrder_Active'
)
BEGIN
    DROP INDEX UX_Nodes_Hierarchy_LayerOrder_Active ON dbo.Nodes;
END;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Nodes')
      AND name = 'UX_Nodes_Hierarchy_PinnedOrder_Active'
)
BEGIN
    DROP INDEX UX_Nodes_Hierarchy_PinnedOrder_Active ON dbo.Nodes;
END;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.NodeConnections')
      AND name = 'UX_NodeConnections_Hierarchy_ConnectionKey_Active'
)
BEGIN
    DROP INDEX UX_NodeConnections_Hierarchy_ConnectionKey_Active ON dbo.NodeConnections;
END;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.NodeConnections')
      AND name = 'UX_NodeConnections_Hierarchy_Edge_Active'
)
BEGIN
    DROP INDEX UX_NodeConnections_Hierarchy_Edge_Active ON dbo.NodeConnections;
END;

-- Remove stale component-domain tables if they exist from an earlier mistaken draft.
IF OBJECT_ID('dbo.ComponentLinkKeyframes', 'U') IS NOT NULL DROP TABLE dbo.ComponentLinkKeyframes;
IF OBJECT_ID('dbo.ComponentAssetArtifacts', 'U') IS NOT NULL DROP TABLE dbo.ComponentAssetArtifacts;
IF OBJECT_ID('dbo.ComponentAssets', 'U') IS NOT NULL DROP TABLE dbo.ComponentAssets;
IF OBJECT_ID('dbo.ComponentLinks', 'U') IS NOT NULL DROP TABLE dbo.ComponentLinks;
IF OBJECT_ID('dbo.Components', 'U') IS NOT NULL DROP TABLE dbo.Components;

-- Chart-scoped nodes. This is the shared canvas state that should render identically for every viewer.
IF OBJECT_ID('dbo.Nodes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Nodes (
        NodeId bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ChartId int NOT NULL,
        NodeKey nvarchar(64) NOT NULL,
        Title nvarchar(200) NOT NULL CONSTRAINT DF_Nodes_Title DEFAULT N'',
        PositionX decimal(18,6) NOT NULL CONSTRAINT DF_Nodes_PositionX DEFAULT 0,
        PositionY decimal(18,6) NOT NULL CONSTRAINT DF_Nodes_PositionY DEFAULT 0,
        Width decimal(18,6) NOT NULL CONSTRAINT DF_Nodes_Width DEFAULT 290,
        Height decimal(18,6) NOT NULL CONSTRAINT DF_Nodes_Height DEFAULT 160,
        LayerOrder int NOT NULL CONSTRAINT DF_Nodes_LayerOrder DEFAULT 0,
        IsPinned bit NOT NULL CONSTRAINT DF_Nodes_IsPinned DEFAULT 0,
        PinnedOrder int NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_Nodes_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        CONSTRAINT FK_Nodes_Charts FOREIGN KEY (ChartId) REFERENCES dbo.Charts(ChartId),
        CONSTRAINT CK_Nodes_NodeKey_NotBlank CHECK (LEN(LTRIM(RTRIM(NodeKey))) > 0),
        CONSTRAINT CK_Nodes_Size_Positive CHECK (Width > 0 AND Height > 0),
        CONSTRAINT CK_Nodes_PinnedOrder_Consistency CHECK (
            (IsPinned = 1 AND PinnedOrder IS NOT NULL)
            OR (IsPinned = 0 AND PinnedOrder IS NULL)
        )
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_Nodes_Chart_NodeKey_Active' AND object_id = OBJECT_ID('dbo.Nodes')
)
BEGIN
    CREATE UNIQUE INDEX UX_Nodes_Chart_NodeKey_Active
        ON dbo.Nodes(ChartId, NodeKey);
END;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Nodes')
      AND name = 'UX_Nodes_Chart_NodeKey_Active'
      AND has_filter = 1
)
BEGIN
    DROP INDEX UX_Nodes_Chart_NodeKey_Active ON dbo.Nodes;
    CREATE UNIQUE INDEX UX_Nodes_Chart_NodeKey_Active
        ON dbo.Nodes(ChartId, NodeKey);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_Nodes_Chart_LayerOrder_Active' AND object_id = OBJECT_ID('dbo.Nodes')
)
BEGIN
    CREATE UNIQUE INDEX UX_Nodes_Chart_LayerOrder_Active
        ON dbo.Nodes(ChartId, LayerOrder);
END;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Nodes')
      AND name = 'UX_Nodes_Chart_LayerOrder_Active'
      AND has_filter = 1
)
BEGIN
    DROP INDEX UX_Nodes_Chart_LayerOrder_Active ON dbo.Nodes;
    CREATE UNIQUE INDEX UX_Nodes_Chart_LayerOrder_Active
        ON dbo.Nodes(ChartId, LayerOrder);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_Nodes_Chart_PinnedOrder_Active' AND object_id = OBJECT_ID('dbo.Nodes')
)
BEGIN
    CREATE UNIQUE INDEX UX_Nodes_Chart_PinnedOrder_Active
        ON dbo.Nodes(ChartId, PinnedOrder)
        WHERE IsPinned = 1;
END;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Nodes')
      AND name = 'UX_Nodes_Chart_PinnedOrder_Active'
      AND has_filter = 1
      AND ISNULL(filter_definition, '') <> '([IsPinned]=(1))'
)
BEGIN
    DROP INDEX UX_Nodes_Chart_PinnedOrder_Active ON dbo.Nodes;
    CREATE UNIQUE INDEX UX_Nodes_Chart_PinnedOrder_Active
        ON dbo.Nodes(ChartId, PinnedOrder)
        WHERE IsPinned = 1;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_Nodes_ChartId' AND object_id = OBJECT_ID('dbo.Nodes')
)
BEGIN
    CREATE INDEX IX_Nodes_ChartId ON dbo.Nodes(ChartId, LayerOrder);
END;

-- Chart-scoped node assignments. Order is stored so the node body renders consistently.
IF OBJECT_ID('dbo.NodeUsers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.NodeUsers (
        NodeUserId bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
        NodeId bigint NOT NULL,
        UserOid nvarchar(64) NOT NULL,
        SortOrder int NOT NULL CONSTRAINT DF_NodeUsers_SortOrder DEFAULT 0,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_NodeUsers_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        CONSTRAINT FK_NodeUsers_Nodes FOREIGN KEY (NodeId) REFERENCES dbo.Nodes(NodeId),
        CONSTRAINT FK_NodeUsers_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid)
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_NodeUsers_Node_User_Active' AND object_id = OBJECT_ID('dbo.NodeUsers')
)
BEGIN
    CREATE UNIQUE INDEX UX_NodeUsers_Node_User_Active
        ON dbo.NodeUsers(NodeId, UserOid);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_NodeUsers_Node_SortOrder_Active' AND object_id = OBJECT_ID('dbo.NodeUsers')
)
BEGIN
    CREATE UNIQUE INDEX UX_NodeUsers_Node_SortOrder_Active
        ON dbo.NodeUsers(NodeId, SortOrder);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_NodeUsers_UserOid' AND object_id = OBJECT_ID('dbo.NodeUsers')
)
BEGIN
    CREATE INDEX IX_NodeUsers_UserOid ON dbo.NodeUsers(UserOid);
END;

-- Directional node-to-node links, including the connector side chosen on each end.
IF OBJECT_ID('dbo.NodeConnections', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.NodeConnections (
        NodeConnectionId bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ChartId int NOT NULL,
        ConnectionKey nvarchar(64) NOT NULL,
        SourceNodeId bigint NOT NULL,
        FromSide varchar(6) NOT NULL,
        TargetNodeId bigint NOT NULL,
        ToSide varchar(6) NOT NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_NodeConnections_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        CONSTRAINT FK_NodeConnections_Charts FOREIGN KEY (ChartId) REFERENCES dbo.Charts(ChartId),
        CONSTRAINT FK_NodeConnections_SourceNode FOREIGN KEY (SourceNodeId) REFERENCES dbo.Nodes(NodeId),
        CONSTRAINT FK_NodeConnections_TargetNode FOREIGN KEY (TargetNodeId) REFERENCES dbo.Nodes(NodeId),
        CONSTRAINT CK_NodeConnections_ConnectionKey_NotBlank CHECK (LEN(LTRIM(RTRIM(ConnectionKey))) > 0),
        CONSTRAINT CK_NodeConnections_NoSelfReference CHECK (SourceNodeId <> TargetNodeId),
        CONSTRAINT CK_NodeConnections_FromSide_Valid CHECK (FromSide IN ('top', 'right', 'bottom', 'left')),
        CONSTRAINT CK_NodeConnections_ToSide_Valid CHECK (ToSide IN ('top', 'right', 'bottom', 'left'))
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_NodeConnections_Chart_ConnectionKey_Active' AND object_id = OBJECT_ID('dbo.NodeConnections')
)
BEGIN
    CREATE UNIQUE INDEX UX_NodeConnections_Chart_ConnectionKey_Active
        ON dbo.NodeConnections(ChartId, ConnectionKey);
END;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.NodeConnections')
      AND name = 'UX_NodeConnections_Chart_ConnectionKey_Active'
      AND has_filter = 1
)
BEGIN
    DROP INDEX UX_NodeConnections_Chart_ConnectionKey_Active ON dbo.NodeConnections;
    CREATE UNIQUE INDEX UX_NodeConnections_Chart_ConnectionKey_Active
        ON dbo.NodeConnections(ChartId, ConnectionKey);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_NodeConnections_Chart_Edge_Active' AND object_id = OBJECT_ID('dbo.NodeConnections')
)
BEGIN
    CREATE UNIQUE INDEX UX_NodeConnections_Chart_Edge_Active
        ON dbo.NodeConnections(ChartId, SourceNodeId, FromSide, TargetNodeId, ToSide);
END;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.NodeConnections')
      AND name = 'UX_NodeConnections_Chart_Edge_Active'
      AND has_filter = 1
)
BEGIN
    DROP INDEX UX_NodeConnections_Chart_Edge_Active ON dbo.NodeConnections;
    CREATE UNIQUE INDEX UX_NodeConnections_Chart_Edge_Active
        ON dbo.NodeConnections(ChartId, SourceNodeId, FromSide, TargetNodeId, ToSide);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_NodeConnections_Chart_SourceNode' AND object_id = OBJECT_ID('dbo.NodeConnections')
)
BEGIN
    CREATE INDEX IX_NodeConnections_Chart_SourceNode
        ON dbo.NodeConnections(ChartId, SourceNodeId);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_NodeConnections_Chart_TargetNode' AND object_id = OBJECT_ID('dbo.NodeConnections')
)
BEGIN
    CREATE INDEX IX_NodeConnections_Chart_TargetNode
        ON dbo.NodeConnections(ChartId, TargetNodeId);
END;

IF OBJECT_ID('dbo.TR_NodeConnections_ValidateChartScope', 'TR') IS NOT NULL
BEGIN
    DROP TRIGGER dbo.TR_NodeConnections_ValidateChartScope;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_NodeConnections_ValidateChartScope
ON dbo.NodeConnections
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (
        SELECT 1
        FROM inserted i
        INNER JOIN dbo.Nodes sn ON sn.NodeId = i.SourceNodeId
        INNER JOIN dbo.Nodes tn ON tn.NodeId = i.TargetNodeId
        WHERE sn.ChartId <> i.ChartId
           OR tn.ChartId <> i.ChartId
    )
    BEGIN
        THROW 51010, 'Node connections must reference nodes in the same chart.', 1;
    END;
END;
GO

-- Session store used by auth.
IF OBJECT_ID('dbo.UserSessions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserSessions (
        SessionId uniqueidentifier NOT NULL PRIMARY KEY,
        UserOid nvarchar(64) NOT NULL,
        Email nvarchar(320) NULL,
        Name nvarchar(256) NULL,
        AccessToken nvarchar(max) NOT NULL,
        RefreshToken nvarchar(max) NULL,
        ExpiresAt datetime2 NOT NULL,
        ActiveChartId int NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_UserSessions_CreatedAt DEFAULT sysutcdatetime(),
        CONSTRAINT FK_UserSessions_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid),
        CONSTRAINT FK_UserSessions_ActiveChart FOREIGN KEY (ActiveChartId) REFERENCES dbo.Charts(ChartId)
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_UserSessions_UserOid' AND object_id = OBJECT_ID('dbo.UserSessions')
)
BEGIN
    CREATE INDEX IX_UserSessions_UserOid ON dbo.UserSessions(UserOid);
END;
