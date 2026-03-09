import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';

function parseHierarchyId(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw error(400, 'hierarchyId is required');
	return value;
}

function parseIsActive(value: unknown): boolean {
	if (typeof value !== 'boolean') throw error(400, 'isActive is required');
	return value;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const body = await request.json().catch(() => null);
	const hierarchyId = parseHierarchyId(body?.hierarchyId);
	const isActive = parseIsActive(body?.isActive);
	const pool = await GetPool();

	const managerResult = await pool.request().input('userOid', user.id).input('hierarchyId', hierarchyId).query(`
		SELECT TOP (1) 1 AS IsManager
		FROM dbo.HierarchyUsers hu
		INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
		WHERE hu.UserOid = @userOid
		  AND hu.HierarchyId = @hierarchyId
		  AND hu.IsActive = 1
		  AND hu.DeletedAt IS NULL
		  AND r.RoleName = 'Manager';
	`);

	if (!managerResult.recordset?.[0]?.IsManager) {
		throw error(403, 'Only managers can change hierarchy state');
	}

	await pool.request().input('hierarchyId', hierarchyId).input('isActive', isActive).input('userOid', user.id).query(`
		UPDATE dbo.Hierarchies
		SET IsActive = @isActive,
			UpdatedAt = SYSUTCDATETIME(),
			UpdatedBy = @userOid,
			DeletedAt = CASE WHEN @isActive = 0 THEN SYSUTCDATETIME() ELSE NULL END,
			DeletedBy = CASE WHEN @isActive = 0 THEN @userOid ELSE NULL END
		WHERE HierarchyId = @hierarchyId
		  AND DeletedAt IS NULL;
	`);

	return json({ ok: true, hierarchyId, isActive });
};
