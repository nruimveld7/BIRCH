import { GetPool } from '$lib/server/db';

export type AccessState = {
	hasHierarchies: boolean;
	hasHierarchyUsers: boolean;
	hasHierarchyAccess: boolean;
	isBootstrap: boolean;
	hasAccess: boolean;
};

export async function getAccessState(userOid: string): Promise<AccessState> {
	const pool = await GetPool();
	const result = await pool
		.request()
		.input('userOid', userOid)
		.query(
			`
			DECLARE @hasBootstrap bit = 0;
			DECLARE @hasHierarchyAccess bit = 0;
			DECLARE @hasHierarchies bit = 0;
			DECLARE @hasHierarchyUsers bit = 0;

			IF OBJECT_ID('dbo.BootstrapManagers', 'U') IS NOT NULL
			BEGIN
				IF EXISTS (
					SELECT 1 FROM dbo.BootstrapManagers
					WHERE UserOid = @userOid AND DeletedAt IS NULL AND IsActive = 1
				)
				BEGIN
					SET @hasBootstrap = 1;
				END
			END

			IF OBJECT_ID('dbo.HierarchyUsers', 'U') IS NOT NULL
			BEGIN
				IF EXISTS (
					SELECT 1 FROM dbo.HierarchyUsers
					WHERE DeletedAt IS NULL AND IsActive = 1
				)
				BEGIN
					SET @hasHierarchyUsers = 1;
				END

				IF EXISTS (
					SELECT 1
					FROM dbo.HierarchyUsers hu
					INNER JOIN dbo.Hierarchies h
						ON h.HierarchyId = hu.HierarchyId
					LEFT JOIN dbo.Roles r
						ON r.RoleId = hu.RoleId
					WHERE hu.UserOid = @userOid
					  AND hu.DeletedAt IS NULL
					  AND hu.IsActive = 1
					  AND h.DeletedAt IS NULL
					  AND (h.IsActive = 1 OR r.RoleName = 'Manager')
				)
				BEGIN
					SET @hasHierarchyAccess = 1;
				END
			END

			IF OBJECT_ID('dbo.Hierarchies', 'U') IS NOT NULL
			BEGIN
				IF EXISTS (SELECT 1 FROM dbo.Hierarchies WHERE DeletedAt IS NULL)
				BEGIN
					SET @hasHierarchies = 1;
				END
			END

			SELECT
				@hasBootstrap AS HasBootstrap,
				@hasHierarchyAccess AS HasHierarchyAccess,
				@hasHierarchies AS HasHierarchies,
				@hasHierarchyUsers AS HasHierarchyUsers;
		`
		);

	const row = result.recordset?.[0];
	const hasHierarchies = Boolean(row?.HasHierarchies);
	const hasHierarchyAccess = Boolean(row?.HasHierarchyAccess);
	const isBootstrap = Boolean(row?.HasBootstrap);
	const hasHierarchyUsers = Boolean(row?.HasHierarchyUsers);
	const hasAccess = isBootstrap || hasHierarchyAccess;
	return { hasHierarchies, hasHierarchyUsers, hasHierarchyAccess, isBootstrap, hasAccess };
}
