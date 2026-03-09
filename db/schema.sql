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
        DefaultHierarchyId int NULL,
        HierarchyUiStateJson nvarchar(max) NULL,
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

IF OBJECT_ID('dbo.CK_Users_HierarchyUiStateJson_IsJson', 'C') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_HierarchyUiStateJson_IsJson
    CHECK (HierarchyUiStateJson IS NULL OR ISJSON(HierarchyUiStateJson) = 1);
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

-- Hierarchies replace schedules.
IF OBJECT_ID('dbo.Hierarchies', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Hierarchies (
        HierarchyId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Name nvarchar(200) NOT NULL,
        PlaceholderThemeJson nvarchar(max) NOT NULL,
        IsActive bit NOT NULL CONSTRAINT DF_Hierarchies_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_Hierarchies_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL
    );
END;

IF OBJECT_ID('dbo.CK_Hierarchies_PlaceholderThemeJson_Valid', 'C') IS NULL
BEGIN
    ALTER TABLE dbo.Hierarchies
    ADD CONSTRAINT CK_Hierarchies_PlaceholderThemeJson_Valid CHECK (
        ISJSON(PlaceholderThemeJson) = 1
        AND JSON_VALUE(PlaceholderThemeJson, '$.dark.placeholder') IS NOT NULL
        AND JSON_VALUE(PlaceholderThemeJson, '$.light.placeholder') IS NOT NULL
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_Hierarchies_Name_Active' AND object_id = OBJECT_ID('dbo.Hierarchies')
)
BEGIN
    CREATE UNIQUE INDEX UX_Hierarchies_Name_Active
        ON dbo.Hierarchies(Name)
        WHERE DeletedAt IS NULL;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Users_DefaultHierarchy' AND parent_object_id = OBJECT_ID('dbo.Users')
)
BEGIN
    ALTER TABLE dbo.Users WITH CHECK
    ADD CONSTRAINT FK_Users_DefaultHierarchy FOREIGN KEY (DefaultHierarchyId) REFERENCES dbo.Hierarchies(HierarchyId);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_Users_DefaultHierarchyId' AND object_id = OBJECT_ID('dbo.Users')
)
BEGIN
    CREATE INDEX IX_Users_DefaultHierarchyId ON dbo.Users(DefaultHierarchyId);
END;

-- User membership to hierarchy with role.
IF OBJECT_ID('dbo.HierarchyUsers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.HierarchyUsers (
        HierarchyUserId bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
        HierarchyId int NOT NULL,
        UserOid nvarchar(64) NOT NULL,
        RoleId int NOT NULL,
        GrantedAt datetime2 NOT NULL CONSTRAINT DF_HierarchyUsers_GrantedAt DEFAULT sysutcdatetime(),
        GrantedBy nvarchar(64) NULL,
        IsActive bit NOT NULL CONSTRAINT DF_HierarchyUsers_IsActive DEFAULT 1,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT FK_HierarchyUsers_Hierarchies FOREIGN KEY (HierarchyId) REFERENCES dbo.Hierarchies(HierarchyId),
        CONSTRAINT FK_HierarchyUsers_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid),
        CONSTRAINT FK_HierarchyUsers_Roles FOREIGN KEY (RoleId) REFERENCES dbo.Roles(RoleId)
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_HierarchyUsers_Hierarchy_User_Active' AND object_id = OBJECT_ID('dbo.HierarchyUsers')
)
BEGIN
    CREATE UNIQUE INDEX UX_HierarchyUsers_Hierarchy_User_Active
        ON dbo.HierarchyUsers(HierarchyId, UserOid)
        WHERE DeletedAt IS NULL;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_HierarchyUsers_UserOid' AND object_id = OBJECT_ID('dbo.HierarchyUsers')
)
BEGIN
    CREATE INDEX IX_HierarchyUsers_UserOid ON dbo.HierarchyUsers(UserOid);
END;

-- Reusable component definitions scoped to hierarchy.
IF OBJECT_ID('dbo.Components', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Components (
        ComponentId bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
        HierarchyId int NOT NULL,
        Name nvarchar(200) NOT NULL,
        ItemNumber nvarchar(100) NULL,
        IsActive bit NOT NULL CONSTRAINT DF_Components_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_Components_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT FK_Components_Hierarchies FOREIGN KEY (HierarchyId) REFERENCES dbo.Hierarchies(HierarchyId)
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_Components_Hierarchy_Name_Active' AND object_id = OBJECT_ID('dbo.Components')
)
BEGIN
    CREATE UNIQUE INDEX UX_Components_Hierarchy_Name_Active
        ON dbo.Components(HierarchyId, Name)
        WHERE DeletedAt IS NULL;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_Components_HierarchyId' AND object_id = OBJECT_ID('dbo.Components')
)
BEGIN
    CREATE INDEX IX_Components_HierarchyId ON dbo.Components(HierarchyId);
END;

-- Parent/child composition graph (DAG) for reusable components.
IF OBJECT_ID('dbo.ComponentLinks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ComponentLinks (
        ComponentLinkId bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
        HierarchyId int NOT NULL,
        ParentComponentId bigint NOT NULL,
        ChildComponentId bigint NOT NULL,
        InstanceCount int NOT NULL CONSTRAINT DF_ComponentLinks_InstanceCount DEFAULT 1,
        SortOrder int NOT NULL CONSTRAINT DF_ComponentLinks_SortOrder DEFAULT 0,
        IsActive bit NOT NULL CONSTRAINT DF_ComponentLinks_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_ComponentLinks_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT FK_ComponentLinks_Hierarchies FOREIGN KEY (HierarchyId) REFERENCES dbo.Hierarchies(HierarchyId),
        CONSTRAINT FK_ComponentLinks_ParentComponent FOREIGN KEY (ParentComponentId) REFERENCES dbo.Components(ComponentId),
        CONSTRAINT FK_ComponentLinks_ChildComponent FOREIGN KEY (ChildComponentId) REFERENCES dbo.Components(ComponentId),
        CONSTRAINT CK_ComponentLinks_NoSelfReference CHECK (ParentComponentId <> ChildComponentId),
        CONSTRAINT CK_ComponentLinks_InstanceCount CHECK (InstanceCount > 0)
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_ComponentLinks_Parent' AND object_id = OBJECT_ID('dbo.ComponentLinks')
)
BEGIN
    CREATE INDEX IX_ComponentLinks_Parent ON dbo.ComponentLinks(HierarchyId, ParentComponentId, SortOrder);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_ComponentLinks_Child' AND object_id = OBJECT_ID('dbo.ComponentLinks')
)
BEGIN
    CREATE INDEX IX_ComponentLinks_Child ON dbo.ComponentLinks(HierarchyId, ChildComponentId);
END;

IF OBJECT_ID('dbo.TR_ComponentLinks_PreventRecursion', 'TR') IS NOT NULL
BEGIN
    DROP TRIGGER dbo.TR_ComponentLinks_PreventRecursion;
END;
GO
CREATE TRIGGER dbo.TR_ComponentLinks_PreventRecursion
ON dbo.ComponentLinks
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (
        SELECT 1
        FROM inserted i
        WHERE i.ParentComponentId = i.ChildComponentId
          AND i.DeletedAt IS NULL
    )
    BEGIN
        THROW 51000, 'A component cannot contain itself.', 1;
    END;

    ;WITH StartEdges AS (
        SELECT i.HierarchyId, i.ParentComponentId, i.ChildComponentId
        FROM inserted i
        WHERE i.DeletedAt IS NULL
    ),
    Walk AS (
        SELECT s.HierarchyId, s.ParentComponentId, s.ChildComponentId
        FROM StartEdges s
        UNION ALL
        SELECT w.HierarchyId, w.ParentComponentId, cl.ChildComponentId
        FROM Walk w
        INNER JOIN dbo.ComponentLinks cl
            ON cl.HierarchyId = w.HierarchyId
           AND cl.ParentComponentId = w.ChildComponentId
           AND cl.DeletedAt IS NULL
           AND cl.IsActive = 1
    )
    SELECT TOP 1 1
    FROM Walk
    WHERE ParentComponentId = ChildComponentId
    OPTION (MAXRECURSION 32767);

    IF @@ROWCOUNT > 0
    BEGIN
        THROW 51001, 'Component composition recursion detected.', 1;
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
        ActiveHierarchyId int NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_UserSessions_CreatedAt DEFAULT sysutcdatetime(),
        CONSTRAINT FK_UserSessions_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid),
        CONSTRAINT FK_UserSessions_ActiveHierarchy FOREIGN KEY (ActiveHierarchyId) REFERENCES dbo.Hierarchies(HierarchyId)
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_UserSessions_UserOid' AND object_id = OBJECT_ID('dbo.UserSessions')
)
BEGIN
    CREATE INDEX IX_UserSessions_UserOid ON dbo.UserSessions(UserOid);
END;
