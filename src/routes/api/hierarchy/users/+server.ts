import { error, json, type Cookies } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveHierarchyId, getSessionAccessTokenByCookie } from '$lib/server/auth';
import { searchTenantUsers } from '$lib/server/graph';

type ActorContext = {
	hierarchyId: number;
	roleName: 'Member' | 'Maintainer' | 'Manager';
};

async function getActorContext(userOid: string, cookies: Cookies): Promise<ActorContext> {
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
			INNER JOIN dbo.Hierarchies h ON h.HierarchyId = hu.HierarchyId
			WHERE hu.UserOid = @userOid
			  AND hu.HierarchyId = @hierarchyId
			  AND hu.DeletedAt IS NULL
			  AND hu.IsActive = 1
			  AND h.DeletedAt IS NULL
			  AND (h.IsActive = 1 OR r.RoleName = 'Manager');
		`);

	const roleName = result.recordset?.[0]?.RoleName as ActorContext['roleName'] | undefined;
	if (!roleName) throw error(403, 'You do not have access to this hierarchy');
	return { hierarchyId, roleName };
}

export const GET: RequestHandler = async ({ locals, cookies, url }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const { hierarchyId } = await getActorContext(user.id, cookies);
	const q = url.searchParams.get('q')?.trim() ?? '';

	if (q) {
		const token = await getSessionAccessTokenByCookie(cookies);
		const users = await searchTenantUsers(token, q, 20);
		return json({
			users: users.map((item) => ({
				userOid: item.id,
				displayName: item.displayName ?? item.userPrincipalName ?? item.id,
				email: item.mail ?? item.userPrincipalName ?? null
			}))
		});
	}

	const pool = await GetPool();
	const result = await pool.request().input('hierarchyId', hierarchyId).query(`
		WITH RankedRoles AS (
			SELECT
				hu.UserOid,
				r.RoleName,
				hu.IsActive,
				hu.GrantedAt,
				ROW_NUMBER() OVER (
					PARTITION BY hu.UserOid
					ORDER BY CASE r.RoleName WHEN 'Manager' THEN 3 WHEN 'Maintainer' THEN 2 ELSE 1 END DESC, hu.GrantedAt DESC
				) AS RoleRank
			FROM dbo.HierarchyUsers hu
			INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
			WHERE hu.HierarchyId = @hierarchyId
			  AND hu.DeletedAt IS NULL
		)
		SELECT
			rr.UserOid,
			COALESCE(NULLIF(LTRIM(RTRIM(u.DisplayName)), ''), NULLIF(LTRIM(RTRIM(u.FullName)), ''), rr.UserOid) AS DisplayName,
			u.Email,
			rr.RoleName,
			rr.IsActive
		FROM RankedRoles rr
		INNER JOIN dbo.Users u ON u.UserOid = rr.UserOid
		WHERE rr.RoleRank = 1
		ORDER BY DisplayName;
	`);

	return json({
		users: (result.recordset ?? []).map((row) => ({
			userOid: String(row.UserOid),
			displayName: String(row.DisplayName),
			email: row.Email ? String(row.Email) : null,
			roleName: row.RoleName,
			isActive: Boolean(row.IsActive)
		}))
	});
};

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const ctx = await getActorContext(user.id, cookies);
	if (!(ctx.roleName === 'Maintainer' || ctx.roleName === 'Manager')) {
		throw error(403, 'Only maintainers or managers can add users');
	}

	const body = await request.json().catch(() => null);
	const targetUserOid = String(body?.targetUserOid ?? '').trim();
	const roleName = String(body?.roleName ?? '').trim();
	if (!targetUserOid) throw error(400, 'targetUserOid is required');
	if (!['Member', 'Maintainer', 'Manager'].includes(roleName)) throw error(400, 'roleName is invalid');
	if (roleName === 'Manager' && ctx.roleName !== 'Manager') throw error(403, 'Only managers can assign manager role');

	const pool = await GetPool();
	await pool.request().input('targetUserOid', targetUserOid).query(`
		MERGE dbo.Users AS target
		USING (SELECT @targetUserOid AS UserOid) AS source
		ON target.UserOid = source.UserOid
		WHEN NOT MATCHED THEN
			INSERT (UserOid, DisplayName, FullName) VALUES (@targetUserOid, @targetUserOid, @targetUserOid)
		WHEN MATCHED THEN
			UPDATE SET UpdatedAt = SYSUTCDATETIME();
	`);

	const roleResult = await pool.request().input('roleName', roleName).query(`SELECT TOP (1) RoleId FROM dbo.Roles WHERE RoleName = @roleName;`);
	const roleId = roleResult.recordset?.[0]?.RoleId;
	if (!roleId) throw error(400, 'role not found');

	await pool
		.request()
		.input('hierarchyId', ctx.hierarchyId)
		.input('targetUserOid', targetUserOid)
		.input('roleId', roleId)
		.input('actorUserOid', user.id)
		.query(`
			MERGE dbo.HierarchyUsers AS target
			USING (SELECT @hierarchyId AS HierarchyId, @targetUserOid AS UserOid) AS source
			ON target.HierarchyId = source.HierarchyId
			AND target.UserOid = source.UserOid
			AND target.DeletedAt IS NULL
			WHEN MATCHED THEN
				UPDATE SET RoleId = @roleId, IsActive = 1, DeletedAt = NULL, DeletedBy = NULL
			WHEN NOT MATCHED THEN
				INSERT (HierarchyId, UserOid, RoleId, GrantedBy)
				VALUES (@hierarchyId, @targetUserOid, @roleId, @actorUserOid);

			UPDATE dbo.Users
			SET DefaultHierarchyId = @hierarchyId,
				UpdatedAt = SYSUTCDATETIME()
			WHERE UserOid = @targetUserOid
			  AND DefaultHierarchyId IS NULL;
		`);

	return json({ ok: true });
};
