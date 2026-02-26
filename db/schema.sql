-- Core schema for schedules, users, roles, patterns, and events.
-- Idempotent: safe to run multiple times.
SET QUOTED_IDENTIFIER ON;

IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        UserOid nvarchar(64) NOT NULL PRIMARY KEY,
        FullName nvarchar(200) NULL,
        DisplayName nvarchar(200) NULL,
        Email nvarchar(320) NULL,
        OnboardingRole tinyint NOT NULL CONSTRAINT DF_Users_OnboardingRole DEFAULT 0,
        DefaultScheduleId int NULL,
        IsActive bit NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT sysutcdatetime(),
        UpdatedAt datetime2 NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL
    );
END;

IF COL_LENGTH('dbo.Users', 'DefaultScheduleId') IS NULL
BEGIN
    ALTER TABLE dbo.Users
    ADD DefaultScheduleId int NULL;
END;

IF COL_LENGTH('dbo.Users', 'ScheduleUiStateJson') IS NULL
BEGIN
    ALTER TABLE dbo.Users
    ADD ScheduleUiStateJson nvarchar(max) NULL;
END;

IF COL_LENGTH('dbo.Users', 'OnboardingRole') IS NULL
BEGIN
    ALTER TABLE dbo.Users
    ADD OnboardingRole tinyint NULL;
END;

IF COL_LENGTH('dbo.Users', 'EntraFirstName') IS NULL
BEGIN
    ALTER TABLE dbo.Users
    ADD EntraFirstName nvarchar(100) NULL;
END;

IF COL_LENGTH('dbo.Users', 'EntraLastName') IS NULL
BEGIN
    ALTER TABLE dbo.Users
    ADD EntraLastName nvarchar(100) NULL;
END;

IF COL_LENGTH('dbo.Users', 'OnboardingRole') IS NOT NULL
BEGIN
    EXEC(N'
        UPDATE dbo.Users
           SET OnboardingRole = 0
         WHERE OnboardingRole IS NULL
            OR OnboardingRole NOT BETWEEN 0 AND 3;
    ');
END;

IF OBJECT_ID('dbo.DF_Users_OnboardingRole', 'D') IS NULL
BEGIN
    ALTER TABLE dbo.Users
    ADD CONSTRAINT DF_Users_OnboardingRole DEFAULT 0 FOR OnboardingRole;
END;

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Users')
      AND name = 'OnboardingRole'
      AND is_nullable = 1
)
BEGIN
    EXEC(N'ALTER TABLE dbo.Users ALTER COLUMN OnboardingRole tinyint NOT NULL;');
END;

IF OBJECT_ID('dbo.CK_Users_OnboardingRole_Valid', 'C') IS NULL
BEGIN
    EXEC(N'
        ALTER TABLE dbo.Users
        ADD CONSTRAINT CK_Users_OnboardingRole_Valid CHECK (OnboardingRole BETWEEN 0 AND 3);
    ');
END;

IF COL_LENGTH('dbo.Users', 'ScheduleUiStateJson') IS NOT NULL
BEGIN
    EXEC(N'
        UPDATE dbo.Users
           SET ScheduleUiStateJson = NULL
         WHERE ScheduleUiStateJson IS NOT NULL
           AND ISJSON(ScheduleUiStateJson) <> 1;
    ');
END;

IF OBJECT_ID('dbo.CK_Users_ScheduleUiStateJson_IsJson', 'C') IS NULL
BEGIN
    EXEC(N'
        ALTER TABLE dbo.Users
        ADD CONSTRAINT CK_Users_ScheduleUiStateJson_IsJson
        CHECK (ScheduleUiStateJson IS NULL OR ISJSON(ScheduleUiStateJson) = 1);
    ');
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_Users_DefaultSchedule'
      AND parent_object_id = OBJECT_ID('dbo.Users')
)
AND OBJECT_ID('dbo.Schedules', 'U') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Users WITH CHECK
    ADD CONSTRAINT FK_Users_DefaultSchedule FOREIGN KEY (DefaultScheduleId) REFERENCES dbo.Schedules(ScheduleId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_Users_DefaultScheduleId'
      AND object_id = OBJECT_ID('dbo.Users')
)
BEGIN
    CREATE INDEX IX_Users_DefaultScheduleId ON dbo.Users (DefaultScheduleId);
END;

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
        ActiveScheduleId int NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_UserSessions_CreatedAt DEFAULT sysutcdatetime(),
        CONSTRAINT FK_UserSessions_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid)
    );
END;

IF COL_LENGTH('dbo.UserSessions', 'ActiveScheduleId') IS NULL
BEGIN
    ALTER TABLE dbo.UserSessions
    ADD ActiveScheduleId int NULL;
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_UserSessions_UserOid'
      AND object_id = OBJECT_ID('dbo.UserSessions')
)
BEGIN
    CREATE INDEX IX_UserSessions_UserOid ON dbo.UserSessions(UserOid);
END;

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

IF OBJECT_ID('dbo.Schedules', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Schedules (
        ScheduleId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Name nvarchar(200) NOT NULL,
        Description nvarchar(400) NULL,
        ThemeJson nvarchar(max) NOT NULL CONSTRAINT DF_Schedules_ThemeJson DEFAULT (
            N'{"dark":{"background":"#07080b","text":"#ffffff","accent":"#c8102e","todayColor":"#c8102e","weekendColor":"#000000","weekdayColor":"#161a22","pageBorderColor":"#292a30","scheduleBorderColor":"#292a30","primaryGradient1":"#7a1b2c","primaryGradient2":"#2d1118","secondaryGradient1":"#361219","secondaryGradient2":"#0c0e12"},"light":{"background":"#f2f3f5","text":"#000000","accent":"#c8102e","todayColor":"#c8102e","weekendColor":"#d4d7de","weekdayColor":"#f5f6f8","pageBorderColor":"#bbbec6","scheduleBorderColor":"#bbbec6","primaryGradient1":"#f4d7dd","primaryGradient2":"#f8f9fb","secondaryGradient1":"#faeef0","secondaryGradient2":"#f5f6f8"}}'
        ),
        IsActive bit NOT NULL CONSTRAINT DF_Schedules_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_Schedules_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL
    );
END;

IF COL_LENGTH('dbo.Schedules', 'ThemeJson') IS NULL
BEGIN
    ALTER TABLE dbo.Schedules
    ADD ThemeJson nvarchar(max) NULL;
END;

IF OBJECT_ID('dbo.DF_Schedules_ThemeJson', 'D') IS NULL
BEGIN
    ALTER TABLE dbo.Schedules
    ADD CONSTRAINT DF_Schedules_ThemeJson
    DEFAULT (
        N'{"dark":{"background":"#07080b","text":"#ffffff","accent":"#c8102e","todayColor":"#c8102e","weekendColor":"#000000","weekdayColor":"#161a22","pageBorderColor":"#292a30","scheduleBorderColor":"#292a30","primaryGradient1":"#7a1b2c","primaryGradient2":"#2d1118","secondaryGradient1":"#361219","secondaryGradient2":"#0c0e12"},"light":{"background":"#f2f3f5","text":"#000000","accent":"#c8102e","todayColor":"#c8102e","weekendColor":"#d4d7de","weekdayColor":"#f5f6f8","pageBorderColor":"#bbbec6","scheduleBorderColor":"#bbbec6","primaryGradient1":"#f4d7dd","primaryGradient2":"#f8f9fb","secondaryGradient1":"#faeef0","secondaryGradient2":"#f5f6f8"}}'
    ) FOR ThemeJson;
END;

IF COL_LENGTH('dbo.Schedules', 'ThemeJson') IS NOT NULL
BEGIN
    EXEC(N'
        UPDATE dbo.Schedules
        SET ThemeJson = N''{"dark":{"background":"#07080b","text":"#ffffff","accent":"#c8102e","todayColor":"#c8102e","weekendColor":"#000000","weekdayColor":"#161a22","pageBorderColor":"#292a30","scheduleBorderColor":"#292a30","primaryGradient1":"#7a1b2c","primaryGradient2":"#2d1118","secondaryGradient1":"#361219","secondaryGradient2":"#0c0e12"},"light":{"background":"#f2f3f5","text":"#000000","accent":"#c8102e","todayColor":"#c8102e","weekendColor":"#d4d7de","weekdayColor":"#f5f6f8","pageBorderColor":"#bbbec6","scheduleBorderColor":"#bbbec6","primaryGradient1":"#f4d7dd","primaryGradient2":"#f8f9fb","secondaryGradient1":"#faeef0","secondaryGradient2":"#f5f6f8"}}''
        WHERE ThemeJson IS NULL
           OR ISJSON(ThemeJson) <> 1
           OR JSON_VALUE(ThemeJson, ''$.dark.background'') IS NULL
           OR JSON_VALUE(ThemeJson, ''$.dark.text'') IS NULL
           OR JSON_VALUE(ThemeJson, ''$.dark.accent'') IS NULL
           OR JSON_VALUE(ThemeJson, ''$.dark.primaryGradient1'') IS NULL
           OR JSON_VALUE(ThemeJson, ''$.dark.primaryGradient2'') IS NULL
           OR JSON_VALUE(ThemeJson, ''$.dark.secondaryGradient1'') IS NULL
           OR JSON_VALUE(ThemeJson, ''$.dark.secondaryGradient2'') IS NULL
           OR JSON_VALUE(ThemeJson, ''$.light.background'') IS NULL
           OR JSON_VALUE(ThemeJson, ''$.light.text'') IS NULL
           OR JSON_VALUE(ThemeJson, ''$.light.accent'') IS NULL
           OR JSON_VALUE(ThemeJson, ''$.light.primaryGradient1'') IS NULL
           OR JSON_VALUE(ThemeJson, ''$.light.primaryGradient2'') IS NULL
           OR JSON_VALUE(ThemeJson, ''$.light.secondaryGradient1'') IS NULL
           OR JSON_VALUE(ThemeJson, ''$.light.secondaryGradient2'') IS NULL;
    ');

    UPDATE dbo.Schedules
       SET ThemeJson =
            JSON_MODIFY(
            JSON_MODIFY(
            JSON_MODIFY(
            JSON_MODIFY(
            JSON_MODIFY(
            JSON_MODIFY(
            JSON_MODIFY(
            JSON_MODIFY(
            JSON_MODIFY(
            JSON_MODIFY(ThemeJson, '$.dark.todayColor',
                COALESCE(JSON_VALUE(ThemeJson, '$.dark.todayColor'), JSON_VALUE(ThemeJson, '$.dark.accent'), '#c8102e')),
                '$.dark.weekendColor', COALESCE(JSON_VALUE(ThemeJson, '$.dark.weekendColor'), '#000000')),
                '$.dark.weekdayColor', COALESCE(JSON_VALUE(ThemeJson, '$.dark.weekdayColor'), '#161a22')),
                '$.dark.pageBorderColor',
                COALESCE(JSON_VALUE(ThemeJson, '$.dark.pageBorderColor'), JSON_VALUE(ThemeJson, '$.dark.borderColor'), '#292a30')),
                '$.dark.scheduleBorderColor',
                COALESCE(JSON_VALUE(ThemeJson, '$.dark.scheduleBorderColor'), JSON_VALUE(ThemeJson, '$.dark.borderColor'), '#292a30')),
                '$.light.todayColor',
                COALESCE(JSON_VALUE(ThemeJson, '$.light.todayColor'), JSON_VALUE(ThemeJson, '$.light.accent'), '#c8102e')),
                '$.light.weekendColor', COALESCE(JSON_VALUE(ThemeJson, '$.light.weekendColor'), '#d4d7de')),
                '$.light.weekdayColor', COALESCE(JSON_VALUE(ThemeJson, '$.light.weekdayColor'), '#f5f6f8')),
                '$.light.pageBorderColor',
                COALESCE(JSON_VALUE(ThemeJson, '$.light.pageBorderColor'), JSON_VALUE(ThemeJson, '$.light.borderColor'), '#bbbec6')),
                '$.light.scheduleBorderColor',
                COALESCE(JSON_VALUE(ThemeJson, '$.light.scheduleBorderColor'), JSON_VALUE(ThemeJson, '$.light.borderColor'), '#bbbec6'))
     WHERE ISJSON(ThemeJson) = 1
       AND (
            JSON_VALUE(ThemeJson, '$.dark.todayColor') IS NULL
         OR JSON_VALUE(ThemeJson, '$.dark.weekendColor') IS NULL
         OR JSON_VALUE(ThemeJson, '$.dark.weekdayColor') IS NULL
         OR JSON_VALUE(ThemeJson, '$.dark.pageBorderColor') IS NULL
         OR JSON_VALUE(ThemeJson, '$.dark.scheduleBorderColor') IS NULL
         OR JSON_VALUE(ThemeJson, '$.light.todayColor') IS NULL
         OR JSON_VALUE(ThemeJson, '$.light.weekendColor') IS NULL
         OR JSON_VALUE(ThemeJson, '$.light.weekdayColor') IS NULL
         OR JSON_VALUE(ThemeJson, '$.light.pageBorderColor') IS NULL
         OR JSON_VALUE(ThemeJson, '$.light.scheduleBorderColor') IS NULL
       );
END;

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Schedules')
      AND name = 'ThemeJson'
      AND is_nullable = 1
)
BEGIN
    EXEC(N'ALTER TABLE dbo.Schedules ALTER COLUMN ThemeJson nvarchar(max) NOT NULL;');
END;

IF OBJECT_ID('dbo.CK_Schedules_ThemeJson_Valid', 'C') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Schedules DROP CONSTRAINT CK_Schedules_ThemeJson_Valid;
END;

IF COL_LENGTH('dbo.Schedules', 'ThemeJson') IS NOT NULL
BEGIN
    EXEC(N'
        ALTER TABLE dbo.Schedules
        ADD CONSTRAINT CK_Schedules_ThemeJson_Valid CHECK (
            ISJSON(ThemeJson) = 1
            AND JSON_QUERY(ThemeJson, ''$.dark'') IS NOT NULL
            AND JSON_QUERY(ThemeJson, ''$.light'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.dark.background'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.dark.text'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.dark.accent'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.dark.todayColor'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.dark.weekendColor'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.dark.weekdayColor'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.dark.pageBorderColor'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.dark.scheduleBorderColor'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.dark.primaryGradient1'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.dark.primaryGradient2'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.dark.secondaryGradient1'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.dark.secondaryGradient2'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.light.background'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.light.text'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.light.accent'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.light.todayColor'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.light.weekendColor'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.light.weekdayColor'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.light.pageBorderColor'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.light.scheduleBorderColor'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.light.primaryGradient1'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.light.primaryGradient2'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.light.secondaryGradient1'') IS NOT NULL
            AND JSON_VALUE(ThemeJson, ''$.light.secondaryGradient2'') IS NOT NULL
        );
    ');
END;

IF OBJECT_ID('dbo.Roles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Roles (
        RoleId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        RoleName nvarchar(50) NOT NULL
    );

    CREATE UNIQUE INDEX UX_Roles_RoleName ON dbo.Roles(RoleName);
END;

IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleName = 'Member')
    INSERT INTO dbo.Roles (RoleName) VALUES ('Member');
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleName = 'Maintainer')
    INSERT INTO dbo.Roles (RoleName) VALUES ('Maintainer');
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleName = 'Manager')
    INSERT INTO dbo.Roles (RoleName) VALUES ('Manager');

IF OBJECT_ID('dbo.Patterns', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Patterns (
        PatternId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ScheduleId int NOT NULL,
        Name nvarchar(100) NOT NULL,
        PatternSummary nvarchar(100) NOT NULL,
        PatternJson nvarchar(max) NOT NULL,
        IsActive bit NOT NULL CONSTRAINT DF_Patterns_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_Patterns_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT FK_Patterns_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId)
    );
END;

IF COL_LENGTH('dbo.Patterns', 'PatternSummary') IS NULL
BEGIN
    ALTER TABLE dbo.Patterns
    ADD PatternSummary nvarchar(100) NULL;
END;

IF COL_LENGTH('dbo.Patterns', 'PatternSummary') IS NOT NULL
BEGIN
    EXEC(N'
        UPDATE dbo.Patterns
           SET PatternSummary = ''0 shifts'';

        ;WITH SummaryCounts AS (
            SELECT
                p.PatternId,
                COUNT(*) AS ActiveShiftCount
            FROM dbo.Patterns p
            CROSS APPLY OPENJSON(p.PatternJson, ''$.swatches'')
                WITH (onDays nvarchar(max) ''$.onDays'' AS JSON) sw
            WHERE ISJSON(p.PatternJson) = 1
              AND JSON_QUERY(p.PatternJson, ''$.swatches'') IS NOT NULL
              AND EXISTS (SELECT 1 FROM OPENJSON(sw.onDays))
            GROUP BY p.PatternId
        )
        UPDATE p
           SET PatternSummary = CONCAT(
                COALESCE(sc.ActiveShiftCount, 0),
                '' '',
                CASE WHEN COALESCE(sc.ActiveShiftCount, 0) = 1 THEN ''shift'' ELSE ''shifts'' END
           )
        FROM dbo.Patterns p
        LEFT JOIN SummaryCounts sc
               ON sc.PatternId = p.PatternId;

        UPDATE dbo.Patterns
           SET PatternSummary = COALESCE(NULLIF(LTRIM(RTRIM(PatternSummary)), ''''), ''0 shifts'')
         WHERE PatternSummary IS NULL OR LTRIM(RTRIM(PatternSummary)) = '''';
    ');
END;

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Patterns')
      AND name = 'PatternSummary'
      AND is_nullable = 1
)
BEGIN
    EXEC(N'ALTER TABLE dbo.Patterns ALTER COLUMN PatternSummary nvarchar(100) NOT NULL;');
END;

IF OBJECT_ID('dbo.Shifts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Shifts (
        ShiftId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ScheduleId int NOT NULL,
        Name nvarchar(50) NOT NULL,
        StartDate date NOT NULL CONSTRAINT DF_Shifts_StartDate DEFAULT CAST(SYSUTCDATETIME() AS date),
        EndDate date NULL,
        DisplayOrder int NOT NULL CONSTRAINT DF_Shifts_DisplayOrder DEFAULT 0,
        PatternId int NULL,
        IsActive bit NOT NULL CONSTRAINT DF_Shifts_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_Shifts_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT FK_Shifts_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId),
        CONSTRAINT FK_Shifts_Patterns FOREIGN KEY (PatternId) REFERENCES dbo.Patterns(PatternId),
        CONSTRAINT CK_Shifts_DateRange CHECK (EndDate IS NULL OR EndDate >= StartDate)
    );
END;

IF OBJECT_ID('dbo.EmployeeTypes', 'U') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM dbo.Shifts)
BEGIN
    SET IDENTITY_INSERT dbo.Shifts ON;
    INSERT INTO dbo.Shifts (
        ShiftId,
        ScheduleId,
        Name,
        StartDate,
        EndDate,
        DisplayOrder,
        PatternId,
        IsActive,
        CreatedAt,
        CreatedBy,
        UpdatedAt,
        UpdatedBy,
        DeletedAt,
        DeletedBy
    )
    SELECT
        EmployeeTypeId,
        ScheduleId,
        Name,
        StartDate,
        EndDate,
        DisplayOrder,
        PatternId,
        IsActive,
        CreatedAt,
        CreatedBy,
        UpdatedAt,
        UpdatedBy,
        DeletedAt,
        DeletedBy
    FROM dbo.EmployeeTypes;
    SET IDENTITY_INSERT dbo.Shifts OFF;
END;

IF COL_LENGTH('dbo.Shifts', 'StartDate') IS NULL
BEGIN
    ALTER TABLE dbo.Shifts
    ADD StartDate date NULL;
END;

IF COL_LENGTH('dbo.Shifts', 'EndDate') IS NULL
BEGIN
    ALTER TABLE dbo.Shifts
    ADD EndDate date NULL;
END;

IF OBJECT_ID('dbo.DF_Shifts_StartDate', 'D') IS NULL
BEGIN
    ALTER TABLE dbo.Shifts
    ADD CONSTRAINT DF_Shifts_StartDate
    DEFAULT CAST(SYSUTCDATETIME() AS date) FOR StartDate;
END;

IF COL_LENGTH('dbo.Shifts', 'StartDate') IS NOT NULL
BEGIN
    EXEC(N'
        UPDATE dbo.Shifts
           SET StartDate = CAST(CreatedAt AS date)
         WHERE StartDate IS NULL;
    ');
END;

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Shifts')
      AND name = 'StartDate'
      AND is_nullable = 1
)
BEGIN
    EXEC(N'ALTER TABLE dbo.Shifts ALTER COLUMN StartDate date NOT NULL;');
END;

IF OBJECT_ID('dbo.CK_Shifts_DateRange', 'C') IS NULL
BEGIN
    ALTER TABLE dbo.Shifts
    ADD CONSTRAINT CK_Shifts_DateRange CHECK (EndDate IS NULL OR EndDate >= StartDate);
END;

EXEC(N'
    WITH Ordered AS (
        SELECT
            ShiftId,
            ROW_NUMBER() OVER (
                PARTITION BY ScheduleId
                ORDER BY DisplayOrder ASC, Name ASC, ShiftId ASC
            ) AS NextDisplayOrder
        FROM dbo.Shifts
        WHERE IsActive = 1
          AND DeletedAt IS NULL
    )
    UPDATE et
       SET DisplayOrder = o.NextDisplayOrder
    FROM dbo.Shifts et
    INNER JOIN Ordered o
      ON o.ShiftId = et.ShiftId
    WHERE et.DisplayOrder <> o.NextDisplayOrder;
');

IF OBJECT_ID('dbo.CK_Shifts_DisplayOrder_Positive', 'C') IS NULL
BEGIN
    ALTER TABLE dbo.Shifts
    ADD CONSTRAINT CK_Shifts_DisplayOrder_Positive CHECK (DisplayOrder >= 1);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_Shifts_Schedule_DisplayOrder_Active'
      AND object_id = OBJECT_ID('dbo.Shifts')
)
BEGIN
    CREATE INDEX IX_Shifts_Schedule_DisplayOrder_Active
    ON dbo.Shifts (ScheduleId, DisplayOrder, ShiftId)
    WHERE IsActive = 1 AND DeletedAt IS NULL;
END;

-- Pattern JSON contract:
-- {
--   "swatches": [
--     { "swatchIndex": 0, "color": "#RRGGBB", "onDays": [1, 2, ...] }
--   ],
--   "noneSwatch": { "code": "NONE" }
-- }
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Patterns') AND name = 'PatternJson')
BEGIN
    DECLARE @InvalidPatterns TABLE (PatternId int NOT NULL PRIMARY KEY);

    INSERT INTO @InvalidPatterns (PatternId)
    SELECT p.PatternId
    FROM dbo.Patterns p
    WHERE
        ISJSON(p.PatternJson) <> 1
        OR JSON_QUERY(p.PatternJson, '$.swatches') IS NULL
        OR JSON_QUERY(p.PatternJson, '$.swatches[4]') IS NOT NULL
        OR (JSON_QUERY(p.PatternJson, '$.swatches[0]') IS NOT NULL
            AND (JSON_VALUE(p.PatternJson, '$.swatches[0].color') IS NULL
                 OR JSON_QUERY(p.PatternJson, '$.swatches[0].onDays') IS NULL))
        OR (JSON_QUERY(p.PatternJson, '$.swatches[1]') IS NOT NULL
            AND (JSON_VALUE(p.PatternJson, '$.swatches[1].color') IS NULL
                 OR JSON_QUERY(p.PatternJson, '$.swatches[1].onDays') IS NULL))
        OR (JSON_QUERY(p.PatternJson, '$.swatches[2]') IS NOT NULL
            AND (JSON_VALUE(p.PatternJson, '$.swatches[2].color') IS NULL
                 OR JSON_QUERY(p.PatternJson, '$.swatches[2].onDays') IS NULL))
        OR (JSON_QUERY(p.PatternJson, '$.swatches[3]') IS NOT NULL
            AND (JSON_VALUE(p.PatternJson, '$.swatches[3].color') IS NULL
                 OR JSON_QUERY(p.PatternJson, '$.swatches[3].onDays') IS NULL))
        OR (
            JSON_VALUE(p.PatternJson, '$.noneSwatch.code') IS NOT NULL
            AND UPPER(JSON_VALUE(p.PatternJson, '$.noneSwatch.code')) <> 'NONE'
        );

    IF OBJECT_ID('dbo.Shifts', 'U') IS NOT NULL
    BEGIN
        UPDATE et
           SET PatternId = NULL,
               UpdatedAt = SYSUTCDATETIME(),
               UpdatedBy = COALESCE(et.UpdatedBy, 'schema')
        FROM dbo.Shifts et
        INNER JOIN @InvalidPatterns ip
                ON ip.PatternId = et.PatternId
        WHERE et.PatternId IS NOT NULL;
    END;

    DELETE p
    FROM dbo.Patterns p
    INNER JOIN @InvalidPatterns ip
            ON ip.PatternId = p.PatternId;

    UPDATE dbo.Patterns
       SET PatternJson = JSON_MODIFY(PatternJson, '$.noneSwatch', JSON_QUERY('{"code":"NONE"}'))
     WHERE ISJSON(PatternJson) = 1
       AND JSON_QUERY(PatternJson, '$.swatches') IS NOT NULL
       AND JSON_VALUE(PatternJson, '$.noneSwatch.code') IS NULL;
END;

IF OBJECT_ID('dbo.CK_Patterns_PatternJson_Swatches', 'C') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Patterns DROP CONSTRAINT CK_Patterns_PatternJson_Swatches;
END;

ALTER TABLE dbo.Patterns
ADD CONSTRAINT CK_Patterns_PatternJson_Swatches CHECK (
    ISJSON(PatternJson) = 1
    AND JSON_QUERY(PatternJson, '$.swatches') IS NOT NULL
    AND JSON_QUERY(PatternJson, '$.swatches[4]') IS NULL
    AND (JSON_QUERY(PatternJson, '$.swatches[0]') IS NULL
         OR (JSON_VALUE(PatternJson, '$.swatches[0].color') IS NOT NULL
             AND JSON_QUERY(PatternJson, '$.swatches[0].onDays') IS NOT NULL))
    AND (JSON_QUERY(PatternJson, '$.swatches[1]') IS NULL
         OR (JSON_VALUE(PatternJson, '$.swatches[1].color') IS NOT NULL
             AND JSON_QUERY(PatternJson, '$.swatches[1].onDays') IS NOT NULL))
    AND (JSON_QUERY(PatternJson, '$.swatches[2]') IS NULL
         OR (JSON_VALUE(PatternJson, '$.swatches[2].color') IS NOT NULL
             AND JSON_QUERY(PatternJson, '$.swatches[2].onDays') IS NOT NULL))
    AND (JSON_QUERY(PatternJson, '$.swatches[3]') IS NULL
         OR (JSON_VALUE(PatternJson, '$.swatches[3].color') IS NOT NULL
             AND JSON_QUERY(PatternJson, '$.swatches[3].onDays') IS NOT NULL))
    AND (
        JSON_VALUE(PatternJson, '$.noneSwatch.code') IS NULL
        OR UPPER(JSON_VALUE(PatternJson, '$.noneSwatch.code')) = 'NONE'
    )
);

IF OBJECT_ID('dbo.CK_Patterns_Name_NotBlank', 'C') IS NULL
BEGIN
    ALTER TABLE dbo.Patterns
    ADD CONSTRAINT CK_Patterns_Name_NotBlank CHECK (LEN(LTRIM(RTRIM(Name))) > 0);
END;

IF OBJECT_ID('dbo.CK_Patterns_Summary_NotBlank', 'C') IS NULL
BEGIN
    EXEC(N'
        ALTER TABLE dbo.Patterns
        ADD CONSTRAINT CK_Patterns_Summary_NotBlank CHECK (LEN(LTRIM(RTRIM(PatternSummary))) > 0);
    ');
END;

IF COL_LENGTH('dbo.Patterns', 'PatternNameNormalized') IS NULL
BEGIN
    ALTER TABLE dbo.Patterns
    ADD PatternNameNormalized AS UPPER(LTRIM(RTRIM(Name))) PERSISTED;
END;

IF OBJECT_ID('dbo.ShiftEdits', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ShiftEdits (
        ScheduleId int NOT NULL,
        ShiftId int NOT NULL,
        StartDate date NOT NULL,
        EndDate date NULL,
        DisplayOrder int NULL,
        Name nvarchar(50) NOT NULL,
        PatternId int NULL,
        IsActive bit NOT NULL CONSTRAINT DF_ShiftEdits_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_ShiftEdits_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        EndedAt datetime2 NULL,
        EndedBy nvarchar(64) NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT PK_ShiftEdits PRIMARY KEY (ScheduleId, ShiftId, StartDate),
        CONSTRAINT FK_ShiftEdits_Shifts FOREIGN KEY (ShiftId) REFERENCES dbo.Shifts(ShiftId),
        CONSTRAINT FK_ShiftEdits_Patterns FOREIGN KEY (PatternId) REFERENCES dbo.Patterns(PatternId),
        CONSTRAINT CK_ShiftEdits_DateRange CHECK (EndDate IS NULL OR EndDate >= StartDate),
        CONSTRAINT CK_ShiftEdits_Name_NotBlank CHECK (LEN(LTRIM(RTRIM(Name))) > 0)
    );
END;

IF OBJECT_ID('dbo.EmployeeTypeVersions', 'U') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM dbo.ShiftEdits)
BEGIN
    INSERT INTO dbo.ShiftEdits (
        ScheduleId,
        ShiftId,
        StartDate,
        EndDate,
        DisplayOrder,
        Name,
        PatternId,
        IsActive,
        CreatedAt,
        CreatedBy,
        UpdatedAt,
        UpdatedBy,
        EndedAt,
        EndedBy,
        DeletedAt,
        DeletedBy
    )
    SELECT
        ScheduleId,
        EmployeeTypeId,
        StartDate,
        EndDate,
        DisplayOrder,
        Name,
        PatternId,
        IsActive,
        CreatedAt,
        CreatedBy,
        UpdatedAt,
        UpdatedBy,
        EndedAt,
        EndedBy,
        DeletedAt,
        DeletedBy
    FROM dbo.EmployeeTypeVersions;
END;

IF COL_LENGTH('dbo.ShiftEdits', 'DisplayOrder') IS NULL
BEGIN
    ALTER TABLE dbo.ShiftEdits
    ADD DisplayOrder int NULL;
END;

IF COL_LENGTH('dbo.ShiftEdits', 'DisplayOrder') IS NOT NULL
BEGIN
    EXEC(N'
        UPDATE etv
           SET DisplayOrder = et.DisplayOrder
          FROM dbo.ShiftEdits etv
          INNER JOIN dbo.Shifts et
            ON et.ShiftId = etv.ShiftId
         WHERE etv.DisplayOrder IS NULL;
    ');
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_ShiftEdits_Schedule_Start_End'
      AND object_id = OBJECT_ID('dbo.ShiftEdits')
)
BEGIN
    CREATE INDEX IX_ShiftEdits_Schedule_Start_End
    ON dbo.ShiftEdits (ScheduleId, StartDate, EndDate, ShiftId)
    WHERE IsActive = 1 AND DeletedAt IS NULL;
END;

IF NOT EXISTS (
    SELECT 1 FROM dbo.ShiftEdits
)
BEGIN
    IF COL_LENGTH('dbo.ShiftEdits', 'DisplayOrder') IS NOT NULL
    BEGIN
        EXEC(N'
            INSERT INTO dbo.ShiftEdits (
                ScheduleId,
                ShiftId,
                StartDate,
                EndDate,
                DisplayOrder,
                Name,
                PatternId,
                CreatedAt,
                CreatedBy,
                IsActive
            )
            SELECT
                et.ScheduleId,
                et.ShiftId,
                et.StartDate,
                et.EndDate,
                et.DisplayOrder,
                et.Name,
                et.PatternId,
                ISNULL(et.CreatedAt, SYSUTCDATETIME()),
                et.CreatedBy,
                1
            FROM dbo.Shifts et
            WHERE et.DeletedAt IS NULL
              AND et.IsActive = 1;
        ');
    END;
    ELSE
    BEGIN
        INSERT INTO dbo.ShiftEdits (
            ScheduleId,
            ShiftId,
            StartDate,
            EndDate,
            Name,
            PatternId,
            CreatedAt,
            CreatedBy,
            IsActive
        )
        SELECT
            et.ScheduleId,
            et.ShiftId,
            et.StartDate,
            et.EndDate,
            et.Name,
            et.PatternId,
            ISNULL(et.CreatedAt, SYSUTCDATETIME()),
            et.CreatedBy,
            1
        FROM dbo.Shifts et
        WHERE et.DeletedAt IS NULL
          AND et.IsActive = 1;
    END;
END;

IF OBJECT_ID('dbo.ScheduleShiftOrders', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ScheduleShiftOrders (
        ScheduleId int NOT NULL,
        EffectiveMonth date NOT NULL,
        ShiftId int NOT NULL,
        DisplayOrder int NOT NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_ScheduleShiftOrders_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        CONSTRAINT PK_ScheduleShiftOrders PRIMARY KEY (ScheduleId, EffectiveMonth, ShiftId),
        CONSTRAINT FK_ScheduleShiftOrders_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId),
        CONSTRAINT FK_ScheduleShiftOrders_Shifts FOREIGN KEY (ShiftId)
            REFERENCES dbo.Shifts(ShiftId),
        CONSTRAINT CK_ScheduleShiftOrders_MonthStart CHECK (DAY(EffectiveMonth) = 1),
        CONSTRAINT CK_ScheduleShiftOrders_DisplayOrder CHECK (DisplayOrder >= 1)
    );
END;

IF OBJECT_ID('dbo.ShiftOrderMonthItems', 'U') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM dbo.ScheduleShiftOrders)
BEGIN
    INSERT INTO dbo.ScheduleShiftOrders (
        ScheduleId,
        EffectiveMonth,
        ShiftId,
        DisplayOrder,
        CreatedAt,
        CreatedBy,
        UpdatedAt,
        UpdatedBy
    )
    SELECT
        ScheduleId,
        EffectiveMonth,
        EmployeeTypeId,
        DisplayOrder,
        CreatedAt,
        CreatedBy,
        UpdatedAt,
        UpdatedBy
    FROM dbo.ShiftOrderMonthItems;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_ScheduleShiftOrders_ScheduleMonth_Order'
      AND object_id = OBJECT_ID('dbo.ScheduleShiftOrders')
)
BEGIN
    CREATE UNIQUE INDEX UX_ScheduleShiftOrders_ScheduleMonth_Order
    ON dbo.ScheduleShiftOrders (ScheduleId, EffectiveMonth, DisplayOrder);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_ScheduleShiftOrders_Schedule_EffectiveMonth'
      AND object_id = OBJECT_ID('dbo.ScheduleShiftOrders')
)
BEGIN
    CREATE INDEX IX_ScheduleShiftOrders_Schedule_EffectiveMonth
    ON dbo.ScheduleShiftOrders (ScheduleId, EffectiveMonth DESC);
END;

IF OBJECT_ID('dbo.ScheduleAssignmentOrders', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ScheduleAssignmentOrders (
        ScheduleId int NOT NULL,
        EffectiveMonth date NOT NULL,
        ShiftId int NOT NULL,
        UserOid nvarchar(64) NOT NULL,
        DisplayOrder int NOT NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_ScheduleAssignmentOrders_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        CONSTRAINT PK_ScheduleAssignmentOrders PRIMARY KEY (ScheduleId, EffectiveMonth, ShiftId, UserOid),
        CONSTRAINT FK_ScheduleAssignmentOrders_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId),
        CONSTRAINT FK_ScheduleAssignmentOrders_Shifts FOREIGN KEY (ShiftId) REFERENCES dbo.Shifts(ShiftId),
        CONSTRAINT FK_ScheduleAssignmentOrders_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid),
        CONSTRAINT CK_ScheduleAssignmentOrders_MonthStart CHECK (DAY(EffectiveMonth) = 1),
        CONSTRAINT CK_ScheduleAssignmentOrders_DisplayOrder CHECK (DisplayOrder >= 1)
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_ScheduleAssignmentOrders_ScheduleMonthShift_Order'
      AND object_id = OBJECT_ID('dbo.ScheduleAssignmentOrders')
)
BEGIN
    CREATE UNIQUE INDEX UX_ScheduleAssignmentOrders_ScheduleMonthShift_Order
    ON dbo.ScheduleAssignmentOrders (ScheduleId, EffectiveMonth, ShiftId, DisplayOrder);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_ScheduleAssignmentOrders_Schedule_Month'
      AND object_id = OBJECT_ID('dbo.ScheduleAssignmentOrders')
)
BEGIN
    CREATE INDEX IX_ScheduleAssignmentOrders_Schedule_Month
    ON dbo.ScheduleAssignmentOrders (ScheduleId, EffectiveMonth DESC, ShiftId, DisplayOrder);
END;

IF OBJECT_ID('dbo.EventCodes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.EventCodes (
        EventCodeId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ScheduleId int NOT NULL,
        Code nvarchar(20) NOT NULL,
        Label nvarchar(100) NULL,
        DisplayMode nvarchar(30) NOT NULL CONSTRAINT DF_EventCodes_DisplayMode DEFAULT 'Schedule Overlay',
        Color nvarchar(20) NULL,
        SortOrder int NOT NULL CONSTRAINT DF_EventCodes_SortOrder DEFAULT 0,
        IsActive bit NOT NULL CONSTRAINT DF_EventCodes_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_EventCodes_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT FK_EventCodes_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId)
    );
END;

IF OBJECT_ID('dbo.CoverageCodes', 'U') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM dbo.EventCodes)
BEGIN
    SET IDENTITY_INSERT dbo.EventCodes ON;
    INSERT INTO dbo.EventCodes (
        EventCodeId,
        ScheduleId,
        Code,
        Label,
        DisplayMode,
        Color,
        SortOrder,
        IsActive,
        CreatedAt,
        CreatedBy,
        DeletedAt,
        DeletedBy
    )
    SELECT
        CoverageCodeId,
        ScheduleId,
        Code,
        Label,
        COALESCE(DisplayMode, 'Schedule Overlay'),
        Color,
        SortOrder,
        IsActive,
        CreatedAt,
        CreatedBy,
        DeletedAt,
        DeletedBy
    FROM dbo.CoverageCodes;
    SET IDENTITY_INSERT dbo.EventCodes OFF;
END;

IF COL_LENGTH('dbo.EventCodes', 'DisplayMode') IS NULL
BEGIN
    ALTER TABLE dbo.EventCodes
    ADD DisplayMode nvarchar(30) NULL;
END;

IF COL_LENGTH('dbo.EventCodes', 'DisplayMode') IS NOT NULL
BEGIN
    EXEC(N'
        UPDATE dbo.EventCodes
           SET DisplayMode = ''Schedule Overlay''
         WHERE DisplayMode IS NULL
            OR LTRIM(RTRIM(DisplayMode)) = '''';
    ');
END;

IF OBJECT_ID('dbo.DF_EventCodes_DisplayMode', 'D') IS NULL
AND COL_LENGTH('dbo.EventCodes', 'DisplayMode') IS NOT NULL
BEGIN
    EXEC(N'
        ALTER TABLE dbo.EventCodes
        ADD CONSTRAINT DF_EventCodes_DisplayMode
        DEFAULT ''Schedule Overlay'' FOR DisplayMode;
    ');
END;

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.EventCodes')
      AND name = 'DisplayMode'
      AND is_nullable = 1
)
BEGIN
    EXEC(N'ALTER TABLE dbo.EventCodes ALTER COLUMN DisplayMode nvarchar(30) NOT NULL;');
END;

IF OBJECT_ID('dbo.CK_EventCodes_DisplayMode', 'C') IS NULL
AND COL_LENGTH('dbo.EventCodes', 'DisplayMode') IS NOT NULL
BEGIN
    EXEC(N'
        ALTER TABLE dbo.EventCodes
        ADD CONSTRAINT CK_EventCodes_DisplayMode
        CHECK (DisplayMode IN (''Schedule Overlay'', ''Badge Indicator'', ''Shift Override''));
    ');
END;

IF COL_LENGTH('dbo.EventCodes', 'UpdatedAt') IS NULL
BEGIN
    ALTER TABLE dbo.EventCodes
    ADD UpdatedAt datetime2 NULL;
END;

IF COL_LENGTH('dbo.EventCodes', 'UpdatedBy') IS NULL
BEGIN
    ALTER TABLE dbo.EventCodes
    ADD UpdatedBy nvarchar(64) NULL;
END;

IF COL_LENGTH('dbo.EventCodes', 'NotifyImmediately') IS NULL
BEGIN
    ALTER TABLE dbo.EventCodes
    ADD NotifyImmediately bit NOT NULL
        CONSTRAINT DF_EventCodes_NotifyImmediately DEFAULT 0;
END;

IF COL_LENGTH('dbo.EventCodes', 'ScheduledRemindersJson') IS NULL
BEGIN
    ALTER TABLE dbo.EventCodes
    ADD ScheduledRemindersJson nvarchar(max) NULL;
END;

IF COL_LENGTH('dbo.EventCodes', 'ScheduledRemindersJson') IS NOT NULL
BEGIN
    EXEC(N'
        UPDATE dbo.EventCodes
           SET ScheduledRemindersJson = NULL
         WHERE ScheduledRemindersJson IS NOT NULL
           AND ISJSON(ScheduledRemindersJson) <> 1;
    ');
END;

IF OBJECT_ID('dbo.CK_EventCodes_ScheduledRemindersJson_IsJson', 'C') IS NULL
AND COL_LENGTH('dbo.EventCodes', 'ScheduledRemindersJson') IS NOT NULL
BEGIN
    EXEC(N'
        ALTER TABLE dbo.EventCodes
        ADD CONSTRAINT CK_EventCodes_ScheduledRemindersJson_IsJson
        CHECK (
            ScheduledRemindersJson IS NULL
            OR ISJSON(ScheduledRemindersJson) = 1
            OR LTRIM(RTRIM(ScheduledRemindersJson)) = ''''
        );
    ');
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'UX_EventCodes_Schedule_Code_Active'
      AND object_id = OBJECT_ID('dbo.EventCodes')
)
BEGIN
    CREATE UNIQUE INDEX UX_EventCodes_Schedule_Code_Active
    ON dbo.EventCodes (ScheduleId, Code)
    WHERE DeletedAt IS NULL;
END;

IF OBJECT_ID('dbo.ScheduleUsers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ScheduleUsers (
        ScheduleId int NOT NULL,
        UserOid nvarchar(64) NOT NULL,
        RoleId int NOT NULL,
        GrantedAt datetime2 NOT NULL CONSTRAINT DF_ScheduleUsers_GrantedAt DEFAULT sysutcdatetime(),
        GrantedBy nvarchar(64) NULL,
        IsActive bit NOT NULL CONSTRAINT DF_ScheduleUsers_IsActive DEFAULT 1,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT PK_ScheduleUsers PRIMARY KEY (ScheduleId, UserOid, RoleId),
        CONSTRAINT FK_ScheduleUsers_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId),
        CONSTRAINT FK_ScheduleUsers_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid),
        CONSTRAINT FK_ScheduleUsers_Roles FOREIGN KEY (RoleId) REFERENCES dbo.Roles(RoleId)
    );
END;

IF OBJECT_ID('dbo.ScheduleAssignments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ScheduleAssignments (
        ScheduleId int NOT NULL,
        UserOid nvarchar(64) NOT NULL,
        ShiftId int NOT NULL,
        StartDate date NOT NULL,
        EndDate date NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_ScheduleAssignments_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        EndedAt datetime2 NULL,
        EndedBy nvarchar(64) NULL,
        IsActive bit NOT NULL CONSTRAINT DF_ScheduleAssignments_IsActive DEFAULT 1,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT PK_ScheduleAssignments PRIMARY KEY (ScheduleId, UserOid, ShiftId, StartDate),
        CONSTRAINT FK_ScheduleAssignments_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId),
        CONSTRAINT FK_ScheduleAssignments_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid),
        CONSTRAINT FK_ScheduleAssignments_Shifts FOREIGN KEY (ShiftId) REFERENCES dbo.Shifts(ShiftId),
        CONSTRAINT CK_ScheduleAssignments_DateRange CHECK (EndDate IS NULL OR EndDate >= StartDate)
    );
END;

IF OBJECT_ID('dbo.ScheduleUserTypes', 'U') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM dbo.ScheduleAssignments)
BEGIN
    INSERT INTO dbo.ScheduleAssignments (
        ScheduleId,
        UserOid,
        ShiftId,
        StartDate,
        EndDate,
        CreatedAt,
        CreatedBy,
        EndedAt,
        EndedBy,
        IsActive,
        DeletedAt,
        DeletedBy
    )
    SELECT
        ScheduleId,
        UserOid,
        EmployeeTypeId,
        StartDate,
        EndDate,
        CreatedAt,
        CreatedBy,
        EndedAt,
        EndedBy,
        IsActive,
        DeletedAt,
        DeletedBy
    FROM dbo.ScheduleUserTypes;
END;

IF OBJECT_ID('dbo.ScheduleEvents', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ScheduleEvents (
        EventId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ScheduleId int NOT NULL,
        UserOid nvarchar(64) NULL,
        ShiftId int NULL,
        StartDate date NOT NULL,
        EndDate date NOT NULL,
        EventCodeId int NULL,
        CustomCode nvarchar(16) NULL,
        CustomName nvarchar(100) NULL,
        CustomDisplayMode nvarchar(30) NULL,
        CustomColor nvarchar(20) NULL,
        Title nvarchar(200) NULL,
        Notes nvarchar(max) NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_ScheduleEvents_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        IsActive bit NOT NULL CONSTRAINT DF_ScheduleEvents_IsActive DEFAULT 1,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT FK_ScheduleEvents_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId),
        CONSTRAINT FK_ScheduleEvents_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid),
        CONSTRAINT FK_ScheduleEvents_Shifts FOREIGN KEY (ShiftId) REFERENCES dbo.Shifts(ShiftId),
        CONSTRAINT FK_ScheduleEvents_EventCodes FOREIGN KEY (EventCodeId) REFERENCES dbo.EventCodes(EventCodeId),
        CONSTRAINT CK_ScheduleEvents_DateRange CHECK (EndDate >= StartDate)
    );
END;

IF COL_LENGTH('dbo.ScheduleEvents', 'ShiftId') IS NULL
BEGIN
    ALTER TABLE dbo.ScheduleEvents
    ADD ShiftId int NULL;
END;

IF COL_LENGTH('dbo.ScheduleEvents', 'ShiftId') IS NOT NULL
AND COL_LENGTH('dbo.ScheduleEvents', 'EmployeeTypeId') IS NOT NULL
BEGIN
    EXEC(N'
        UPDATE dbo.ScheduleEvents
           SET ShiftId = EmployeeTypeId
         WHERE ShiftId IS NULL
           AND EmployeeTypeId IS NOT NULL;
    ');
END;

IF COL_LENGTH('dbo.ScheduleEvents', 'EventCodeId') IS NULL
BEGIN
    ALTER TABLE dbo.ScheduleEvents
    ADD EventCodeId int NULL;
END;

IF COL_LENGTH('dbo.ScheduleEvents', 'EventCodeId') IS NOT NULL
AND COL_LENGTH('dbo.ScheduleEvents', 'CoverageCodeId') IS NOT NULL
BEGIN
    EXEC(N'
        UPDATE dbo.ScheduleEvents
           SET EventCodeId = CoverageCodeId
         WHERE EventCodeId IS NULL
           AND CoverageCodeId IS NOT NULL;
    ');
END;

IF COL_LENGTH('dbo.ScheduleEvents', 'CustomCode') IS NULL
BEGIN
    ALTER TABLE dbo.ScheduleEvents
    ADD CustomCode nvarchar(16) NULL;
END;

IF COL_LENGTH('dbo.ScheduleEvents', 'CustomName') IS NULL
BEGIN
    ALTER TABLE dbo.ScheduleEvents
    ADD CustomName nvarchar(100) NULL;
END;

IF COL_LENGTH('dbo.ScheduleEvents', 'CustomDisplayMode') IS NULL
BEGIN
    ALTER TABLE dbo.ScheduleEvents
    ADD CustomDisplayMode nvarchar(30) NULL;
END;

IF COL_LENGTH('dbo.ScheduleEvents', 'CustomColor') IS NULL
BEGIN
    ALTER TABLE dbo.ScheduleEvents
    ADD CustomColor nvarchar(20) NULL;
END;

IF COL_LENGTH('dbo.ScheduleEvents', 'NotifyImmediately') IS NOT NULL
BEGIN
    DECLARE @ScheduleEventsNotifyDefaultConstraint sysname;
    SELECT @ScheduleEventsNotifyDefaultConstraint = dc.name
    FROM sys.default_constraints dc
    INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.ScheduleEvents')
      AND c.name = 'NotifyImmediately';

    IF @ScheduleEventsNotifyDefaultConstraint IS NOT NULL
    BEGIN
        DECLARE @DropScheduleEventsNotifyDefaultSql nvarchar(400);
        SET @DropScheduleEventsNotifyDefaultSql =
            N'ALTER TABLE dbo.ScheduleEvents DROP CONSTRAINT ' +
            QUOTENAME(@ScheduleEventsNotifyDefaultConstraint) +
            N';';
        EXEC sp_executesql @DropScheduleEventsNotifyDefaultSql;
    END;

    ALTER TABLE dbo.ScheduleEvents
    DROP COLUMN NotifyImmediately;
END;

IF COL_LENGTH('dbo.ScheduleEvents', 'ScheduledRemindersJson') IS NULL
BEGIN
    ALTER TABLE dbo.ScheduleEvents
    ADD ScheduledRemindersJson nvarchar(max) NULL;
END;

IF COL_LENGTH('dbo.ScheduleEvents', 'ReminderDispatchStateJson') IS NULL
BEGIN
    ALTER TABLE dbo.ScheduleEvents
    ADD ReminderDispatchStateJson nvarchar(max) NULL;
END;

IF COL_LENGTH('dbo.ScheduleEvents', 'ScheduledRemindersJson') IS NOT NULL
BEGIN
    EXEC(N'
        UPDATE dbo.ScheduleEvents
           SET ScheduledRemindersJson = NULL
         WHERE ScheduledRemindersJson IS NOT NULL
           AND ISJSON(ScheduledRemindersJson) <> 1;
    ');
END;

IF COL_LENGTH('dbo.ScheduleEvents', 'ReminderDispatchStateJson') IS NOT NULL
BEGIN
    EXEC(N'
        UPDATE dbo.ScheduleEvents
           SET ReminderDispatchStateJson = NULL
         WHERE ReminderDispatchStateJson IS NOT NULL
           AND ISJSON(ReminderDispatchStateJson) <> 1;
    ');
END;

IF OBJECT_ID('dbo.CK_ScheduleEvents_ScheduledRemindersJson_IsJson', 'C') IS NULL
AND COL_LENGTH('dbo.ScheduleEvents', 'ScheduledRemindersJson') IS NOT NULL
BEGIN
    EXEC(N'
        ALTER TABLE dbo.ScheduleEvents
        ADD CONSTRAINT CK_ScheduleEvents_ScheduledRemindersJson_IsJson
        CHECK (
            ScheduledRemindersJson IS NULL
            OR ISJSON(ScheduledRemindersJson) = 1
            OR LTRIM(RTRIM(ScheduledRemindersJson)) = ''''
        );
    ');
END;

IF OBJECT_ID('dbo.CK_ScheduleEvents_ReminderDispatchStateJson_IsJson', 'C') IS NULL
AND COL_LENGTH('dbo.ScheduleEvents', 'ReminderDispatchStateJson') IS NOT NULL
BEGIN
    EXEC(N'
        ALTER TABLE dbo.ScheduleEvents
        ADD CONSTRAINT CK_ScheduleEvents_ReminderDispatchStateJson_IsJson
        CHECK (
            ReminderDispatchStateJson IS NULL
            OR ISJSON(ReminderDispatchStateJson) = 1
            OR LTRIM(RTRIM(ReminderDispatchStateJson)) = ''''
        );
    ');
END;

IF OBJECT_ID('dbo.FK_ScheduleEvents_Shifts', 'F') IS NULL
AND COL_LENGTH('dbo.ScheduleEvents', 'ShiftId') IS NOT NULL
BEGIN
    ALTER TABLE dbo.ScheduleEvents
    ADD CONSTRAINT FK_ScheduleEvents_Shifts
    FOREIGN KEY (ShiftId) REFERENCES dbo.Shifts(ShiftId);
END;

IF OBJECT_ID('dbo.FK_ScheduleEvents_EventCodes', 'F') IS NULL
AND COL_LENGTH('dbo.ScheduleEvents', 'EventCodeId') IS NOT NULL
BEGIN
    ALTER TABLE dbo.ScheduleEvents
    ADD CONSTRAINT FK_ScheduleEvents_EventCodes
    FOREIGN KEY (EventCodeId) REFERENCES dbo.EventCodes(EventCodeId);
END;

IF OBJECT_ID('dbo.CK_ScheduleEvents_CustomDisplayMode', 'C') IS NULL
AND COL_LENGTH('dbo.ScheduleEvents', 'CustomDisplayMode') IS NOT NULL
BEGIN
    EXEC(N'
        ALTER TABLE dbo.ScheduleEvents
        ADD CONSTRAINT CK_ScheduleEvents_CustomDisplayMode
        CHECK (
            CustomDisplayMode IS NULL
            OR CustomDisplayMode IN (''Schedule Overlay'', ''Badge Indicator'', ''Shift Override'')
        );
    ');
END;

IF OBJECT_ID('dbo.CK_ScheduleEvents_CustomColor', 'C') IS NULL
AND COL_LENGTH('dbo.ScheduleEvents', 'CustomColor') IS NOT NULL
BEGIN
    EXEC(N'
        ALTER TABLE dbo.ScheduleEvents
        ADD CONSTRAINT CK_ScheduleEvents_CustomColor
        CHECK (
            CustomColor IS NULL
            OR CustomColor LIKE ''#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]''
        );
    ');
END;

IF OBJECT_ID('dbo.CK_ScheduleAssignments_DisplayOrder_Positive', 'C') IS NOT NULL
BEGIN
    ALTER TABLE dbo.ScheduleAssignments DROP CONSTRAINT CK_ScheduleAssignments_DisplayOrder_Positive;
END;

IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_ScheduleAssignments_Schedule_DisplayOrder_Active'
      AND object_id = OBJECT_ID('dbo.ScheduleAssignments')
)
BEGIN
    DROP INDEX IX_ScheduleAssignments_Schedule_DisplayOrder_Active ON dbo.ScheduleAssignments;
END;

IF COL_LENGTH('dbo.ScheduleAssignments', 'DisplayOrder') IS NOT NULL
BEGIN
    DECLARE @ScheduleAssignmentsDisplayOrderDefaultConstraint sysname;
    SELECT @ScheduleAssignmentsDisplayOrderDefaultConstraint = dc.name
    FROM sys.default_constraints dc
    INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.ScheduleAssignments')
      AND c.name = 'DisplayOrder';

    IF @ScheduleAssignmentsDisplayOrderDefaultConstraint IS NOT NULL
    BEGIN
        DECLARE @DropScheduleAssignmentsDisplayOrderDefaultSql nvarchar(400);
        SET @DropScheduleAssignmentsDisplayOrderDefaultSql =
            N'ALTER TABLE dbo.ScheduleAssignments DROP CONSTRAINT ' +
            QUOTENAME(@ScheduleAssignmentsDisplayOrderDefaultConstraint) +
            N';';
        EXEC sp_executesql @DropScheduleAssignmentsDisplayOrderDefaultSql;
    END;

    ALTER TABLE dbo.ScheduleAssignments
    DROP COLUMN DisplayOrder;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_ScheduleAssignments_Range' AND object_id = OBJECT_ID('dbo.ScheduleAssignments')
)
    CREATE INDEX IX_ScheduleAssignments_Range
    ON dbo.ScheduleAssignments (ScheduleId, StartDate, EndDate);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_ScheduleAssignments_User' AND object_id = OBJECT_ID('dbo.ScheduleAssignments')
)
    CREATE INDEX IX_ScheduleAssignments_User
    ON dbo.ScheduleAssignments (ScheduleId, UserOid, StartDate, EndDate);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_ScheduleEvents_Range' AND object_id = OBJECT_ID('dbo.ScheduleEvents')
)
    CREATE INDEX IX_ScheduleEvents_Range
    ON dbo.ScheduleEvents (ScheduleId, StartDate, EndDate);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_ScheduleEvents_Scope_Range' AND object_id = OBJECT_ID('dbo.ScheduleEvents')
)
    CREATE INDEX IX_ScheduleEvents_Scope_Range
    ON dbo.ScheduleEvents (ScheduleId, UserOid, ShiftId, StartDate, EndDate);

IF OBJECT_ID('dbo.ScheduleEventReminderDispatchLog', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.ScheduleEventReminderDispatchLog;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_ScheduleUsers_BySchedule' AND object_id = OBJECT_ID('dbo.ScheduleUsers')
)
    CREATE INDEX IX_ScheduleUsers_BySchedule
    ON dbo.ScheduleUsers (ScheduleId, RoleId);

IF EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_Patterns_Schedule_Name_Active' AND object_id = OBJECT_ID('dbo.Patterns')
)
    DROP INDEX UX_Patterns_Schedule_Name_Active ON dbo.Patterns;

IF EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_Patterns_Schedule_NameNorm_Active' AND object_id = OBJECT_ID('dbo.Patterns')
)
    DROP INDEX UX_Patterns_Schedule_NameNorm_Active ON dbo.Patterns;

CREATE UNIQUE INDEX UX_Patterns_Schedule_NameNorm_Active
ON dbo.Patterns (ScheduleId, PatternNameNormalized)
WHERE IsActive = 1 AND DeletedAt IS NULL;

IF OBJECT_ID('dbo.TR_ScheduleAssignments_NoOverlap', 'TR') IS NULL
BEGIN
    EXEC('
        CREATE TRIGGER dbo.TR_ScheduleAssignments_NoOverlap
        ON dbo.ScheduleAssignments
        AFTER INSERT, UPDATE
        AS
        BEGIN
            SET NOCOUNT ON;

            IF EXISTS (
                SELECT 1
                FROM dbo.ScheduleAssignments t
                JOIN inserted i
                  ON t.ScheduleId = i.ScheduleId
                 AND t.UserOid = i.UserOid
                 AND t.ShiftId = i.ShiftId
                 AND t.StartDate <> i.StartDate
                WHERE
                    t.DeletedAt IS NULL
                    AND t.IsActive = 1
                    AND i.DeletedAt IS NULL
                    AND i.IsActive = 1
                    AND t.StartDate <= ISNULL(i.EndDate, ''9999-12-31'')
                    AND ISNULL(t.EndDate, ''9999-12-31'') >= i.StartDate
            )
            BEGIN
                RAISERROR (''Overlapping ScheduleAssignments range for this user/type.'', 16, 1);
                ROLLBACK TRANSACTION;
                RETURN;
            END
        END
    ');
END;

IF OBJECT_ID('dbo.TR_ShiftEdits_NoOverlap', 'TR') IS NULL
BEGIN
    EXEC('
        CREATE TRIGGER dbo.TR_ShiftEdits_NoOverlap
        ON dbo.ShiftEdits
        AFTER INSERT, UPDATE
        AS
        BEGIN
            SET NOCOUNT ON;

            IF EXISTS (
                SELECT 1
                FROM dbo.ShiftEdits t
                JOIN inserted i
                  ON t.ScheduleId = i.ScheduleId
                 AND t.ShiftId = i.ShiftId
                 AND t.StartDate <> i.StartDate
                WHERE
                    t.DeletedAt IS NULL
                    AND t.IsActive = 1
                    AND i.DeletedAt IS NULL
                    AND i.IsActive = 1
                    AND t.StartDate <= ISNULL(i.EndDate, ''9999-12-31'')
                    AND ISNULL(t.EndDate, ''9999-12-31'') >= i.StartDate
            )
            BEGIN
                RAISERROR (''Overlapping ShiftEdits range for this shift.'', 16, 1);
                ROLLBACK TRANSACTION;
                RETURN;
            END
        END
    ');
END;
