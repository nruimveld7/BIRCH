import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';

function parseHierarchyId(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw error(400, 'A valid hierarchyId is required');
	}
	return value;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const body = await request.json().catch(() => null);
	const hierarchyId = parseHierarchyId(body?.hierarchyId);
	const pool = await GetPool();

	const accessResult = await pool.request().input('userOid', user.id).input('hierarchyId', hierarchyId).query(`
		SELECT TOP (1) 1 AS HasAccess
		FROM dbo.HierarchyUsers hu
		INNER JOIN dbo.Hierarchies h ON h.HierarchyId = hu.HierarchyId
		LEFT JOIN dbo.Roles r ON r.RoleId = hu.RoleId
		WHERE hu.UserOid = @userOid
		  AND hu.HierarchyId = @hierarchyId
		  AND hu.IsActive = 1
		  AND hu.DeletedAt IS NULL
		  AND h.DeletedAt IS NULL
		  AND (h.IsActive = 1 OR r.RoleName = 'Manager');
	`);

	if (!accessResult.recordset?.[0]?.HasAccess) {
		throw error(403, 'You do not have access to this hierarchy');
	}

	await pool.request().input('userOid', user.id).input('defaultHierarchyId', hierarchyId).query(`
		UPDATE dbo.Users
		SET DefaultHierarchyId = @defaultHierarchyId,
			UpdatedAt = SYSUTCDATETIME()
		WHERE UserOid = @userOid
		  AND DeletedAt IS NULL;
	`);

	return json({ ok: true, defaultHierarchyId: hierarchyId });
};
