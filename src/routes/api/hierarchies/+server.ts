import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { setActiveHierarchyForSession } from '$lib/server/auth';

function parseHierarchyName(value: unknown): string {
	if (typeof value !== 'string') throw error(400, 'A valid hierarchyName is required');
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 200) throw error(400, 'hierarchyName must be between 1 and 200 characters');
	return trimmed;
}

const defaultThemeJson = JSON.stringify({ dark: { placeholder: '#c8102e' }, light: { placeholder: '#c8102e' } });

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const body = await request.json().catch(() => null);
	const hierarchyName = parseHierarchyName(body?.hierarchyName);
	const pool = await GetPool();

	const managerAccess = await pool.request().input('userOid', user.id).query(`
		SELECT TOP (1) 1 AS HasManagerAccess
		FROM dbo.HierarchyUsers hu
		INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
		INNER JOIN dbo.Hierarchies h ON h.HierarchyId = hu.HierarchyId
		WHERE hu.UserOid = @userOid
		  AND hu.IsActive = 1
		  AND hu.DeletedAt IS NULL
		  AND r.RoleName = 'Manager'
		  AND h.DeletedAt IS NULL;
	`);

	if (!managerAccess.recordset?.[0]?.HasManagerAccess) {
		throw error(403, 'Only managers can create hierarchies');
	}

	const createResult = await pool
		.request()
		.input('hierarchyName', hierarchyName)
		.input('themeJson', defaultThemeJson)
		.input('userOid', user.id)
		.query(`
			DECLARE @CreatedHierarchy TABLE (HierarchyId int NOT NULL);
			DECLARE @HierarchyId int;
			DECLARE @ManagerRoleId int;

			SELECT TOP (1) @ManagerRoleId = RoleId FROM dbo.Roles WHERE RoleName = 'Manager';
			IF @ManagerRoleId IS NULL THROW 50000, 'Manager role not found', 1;

			INSERT INTO dbo.Hierarchies (Name, PlaceholderThemeJson, CreatedBy)
			OUTPUT INSERTED.HierarchyId INTO @CreatedHierarchy(HierarchyId)
			VALUES (@hierarchyName, @themeJson, @userOid);

			SELECT TOP (1) @HierarchyId = HierarchyId FROM @CreatedHierarchy;
			IF @HierarchyId IS NULL THROW 50000, 'Failed to create hierarchy', 1;

			INSERT INTO dbo.HierarchyUsers (HierarchyId, UserOid, RoleId, GrantedBy)
			VALUES (@HierarchyId, @userOid, @ManagerRoleId, @userOid);

			SELECT @HierarchyId AS HierarchyId;
		`);

	const hierarchyId = createResult.recordset?.[0]?.HierarchyId;
	if (typeof hierarchyId !== 'number') throw error(500, 'Failed to create hierarchy');

	await setActiveHierarchyForSession(cookies, hierarchyId);
	return json({ ok: true, hierarchyId, activeHierarchyId: hierarchyId });
};
