import { error, json, type Cookies } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveHierarchyId } from '$lib/server/auth';

type RoleName = 'Member' | 'Maintainer' | 'Manager';

async function getActorContext(userOid: string, cookies: Cookies) {
	const hierarchyId = await getActiveHierarchyId(cookies);
	if (!hierarchyId) throw error(400, 'No active hierarchy selected');
	const pool = await GetPool();
	const result = await pool
		.request()
		.input('userOid', userOid)
		.input('hierarchyId', hierarchyId)
		.query(`
			SELECT TOP (1) r.RoleName
			FROM dbo.HierarchyUsers hu
			INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
			WHERE hu.UserOid = @userOid
			  AND hu.HierarchyId = @hierarchyId
			  AND hu.DeletedAt IS NULL
			  AND hu.IsActive = 1;
		`);
	const roleName = result.recordset?.[0]?.RoleName as RoleName | undefined;
	if (!roleName) throw error(403, 'You do not have access to this hierarchy');
	return { hierarchyId, roleName };
}

export const PATCH: RequestHandler = async ({ locals, cookies, params, request }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const ctx = await getActorContext(user.id, cookies);
	if (!(ctx.roleName === 'Maintainer' || ctx.roleName === 'Manager')) {
		throw error(403, 'Only maintainers or managers can update users');
	}

	const targetUserOid = decodeURIComponent(params.userOid);
	const body = await request.json().catch(() => null);
	const roleName = body?.roleName ? String(body.roleName) : null;
	const deactivate = body?.deactivate === true;

	const pool = await GetPool();
	if (roleName) {
		if (!['Member', 'Maintainer', 'Manager'].includes(roleName)) throw error(400, 'Invalid roleName');
		if (roleName === 'Manager' && ctx.roleName !== 'Manager') {
			throw error(403, 'Only managers can assign manager role');
		}
		const roleResult = await pool.request().input('roleName', roleName).query(`SELECT TOP (1) RoleId FROM dbo.Roles WHERE RoleName = @roleName;`);
		const roleId = roleResult.recordset?.[0]?.RoleId;
		if (!roleId) throw error(400, 'Role not found');

		await pool
			.request()
			.input('hierarchyId', ctx.hierarchyId)
			.input('targetUserOid', targetUserOid)
			.input('roleId', roleId)
			.query(`
				UPDATE dbo.HierarchyUsers
				SET RoleId = @roleId
				WHERE HierarchyId = @hierarchyId
				  AND UserOid = @targetUserOid
				  AND DeletedAt IS NULL;
			`);
	}

	if (deactivate) {
		const managerCountResult = await pool.request().input('hierarchyId', ctx.hierarchyId).query(`
			SELECT COUNT_BIG(*) AS ManagerCount
			FROM dbo.HierarchyUsers hu
			INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
			WHERE hu.HierarchyId = @hierarchyId
			  AND hu.DeletedAt IS NULL
			  AND hu.IsActive = 1
			  AND r.RoleName = 'Manager';
		`);
		const managerCount = Number(managerCountResult.recordset?.[0]?.ManagerCount ?? 0);
		const targetRoleResult = await pool
			.request()
			.input('hierarchyId', ctx.hierarchyId)
			.input('targetUserOid', targetUserOid)
			.query(`
				SELECT TOP (1) r.RoleName
				FROM dbo.HierarchyUsers hu
				INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
				WHERE hu.HierarchyId = @hierarchyId
				  AND hu.UserOid = @targetUserOid
				  AND hu.DeletedAt IS NULL
				  AND hu.IsActive = 1;
			`);
		if (targetRoleResult.recordset?.[0]?.RoleName === 'Manager' && managerCount <= 1) {
			throw error(400, 'At least one Manager is required for the hierarchy');
		}

		await pool
			.request()
			.input('hierarchyId', ctx.hierarchyId)
			.input('targetUserOid', targetUserOid)
			.input('actorUserOid', user.id)
			.query(`
				UPDATE dbo.HierarchyUsers
				SET IsActive = 0,
					DeletedAt = SYSUTCDATETIME(),
					DeletedBy = @actorUserOid
				WHERE HierarchyId = @hierarchyId
				  AND UserOid = @targetUserOid
				  AND DeletedAt IS NULL;
			`);
	}

	return json({ ok: true });
};
