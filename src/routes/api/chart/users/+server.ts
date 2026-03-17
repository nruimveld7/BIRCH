import { error, json, type Cookies } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveChartId, getSessionAccessTokenByCookie } from '$lib/server/auth';
import { requireChartRole } from '$lib/server/chart-access';
import { searchTenantUsers } from '$lib/server/graph';

type ActorContext = {
	chartId: number;
	roleName: 'Member' | 'Maintainer' | 'Manager';
};

async function getActorContext(userOid: string, cookies: Cookies): Promise<ActorContext> {
	const chartId = await getActiveChartId(cookies);
	if (!chartId) throw error(400, 'No active chart selected');
	const roleName = (await requireChartRole({
		userOid,
		chartId,
		minimumRole: 'Member',
		message: 'You do not have access to this chart'
	})) as ActorContext['roleName'];
	return { chartId, roleName };
}

export const GET: RequestHandler = async ({ locals, cookies, url }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const { chartId } = await getActorContext(user.id, cookies);
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
	const result = await pool.request().input('chartId', chartId).query(`
		WITH RankedRoles AS (
			SELECT
				hu.UserOid,
				r.RoleName,
				hu.GrantedAt,
				ROW_NUMBER() OVER (
					PARTITION BY hu.UserOid
					ORDER BY CASE r.RoleName WHEN 'Manager' THEN 3 WHEN 'Maintainer' THEN 2 ELSE 1 END DESC, hu.GrantedAt DESC
				) AS RoleRank
			FROM dbo.ChartUsers hu
			INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
			WHERE hu.ChartId = @chartId
		)
		SELECT
			rr.UserOid,
			COALESCE(NULLIF(LTRIM(RTRIM(u.DisplayName)), ''), NULLIF(LTRIM(RTRIM(u.FullName)), ''), rr.UserOid) AS DisplayName,
			u.Email,
			rr.RoleName
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
			isActive: true
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
	const displayName = String(body?.displayName ?? '').trim();
	const email =
		typeof body?.email === 'string' && body.email.trim().length > 0 ? body.email.trim() : null;
	const roleName = String(body?.roleName ?? '').trim();
	if (!targetUserOid) throw error(400, 'targetUserOid is required');
	if (!['Member', 'Maintainer', 'Manager'].includes(roleName)) throw error(400, 'roleName is invalid');
	if (roleName === 'Manager' && ctx.roleName !== 'Manager') throw error(403, 'Only managers can assign manager role');

	const normalizedDisplayName = displayName || email || targetUserOid;
	const pool = await GetPool();
	await pool
		.request()
		.input('targetUserOid', targetUserOid)
		.input('displayName', normalizedDisplayName)
		.input('fullName', normalizedDisplayName)
		.input('email', email)
		.query(`
		MERGE dbo.Users AS target
		USING (SELECT @targetUserOid AS UserOid) AS source
		ON target.UserOid = source.UserOid
		WHEN NOT MATCHED THEN
			INSERT (UserOid, DisplayName, FullName, Email)
			VALUES (@targetUserOid, @displayName, @fullName, @email)
		WHEN MATCHED THEN
			UPDATE SET
				DisplayName = CASE
					WHEN NULLIF(LTRIM(RTRIM(target.DisplayName)), '') IS NULL OR target.DisplayName = @targetUserOid
						THEN @displayName
					ELSE target.DisplayName
				END,
				FullName = CASE
					WHEN NULLIF(LTRIM(RTRIM(target.FullName)), '') IS NULL OR target.FullName = @targetUserOid
						THEN @fullName
					ELSE target.FullName
				END,
				Email = COALESCE(NULLIF(@email, ''), target.Email),
				UpdatedAt = SYSUTCDATETIME();
	`);

	const roleResult = await pool.request().input('roleName', roleName).query(`SELECT TOP (1) RoleId FROM dbo.Roles WHERE RoleName = @roleName;`);
	const roleId = roleResult.recordset?.[0]?.RoleId;
	if (!roleId) throw error(400, 'role not found');

	await pool
		.request()
		.input('chartId', ctx.chartId)
		.input('targetUserOid', targetUserOid)
		.input('roleId', roleId)
		.input('actorUserOid', user.id)
		.query(`
			MERGE dbo.ChartUsers AS target
			USING (SELECT @chartId AS ChartId, @targetUserOid AS UserOid) AS source
			ON target.ChartId = source.ChartId
			AND target.UserOid = source.UserOid
			WHEN MATCHED THEN
				UPDATE SET RoleId = @roleId
			WHEN NOT MATCHED THEN
				INSERT (ChartId, UserOid, RoleId, GrantedBy)
				VALUES (@chartId, @targetUserOid, @roleId, @actorUserOid);

			UPDATE dbo.Users
			SET DefaultChartId = @chartId,
				UpdatedAt = SYSUTCDATETIME()
			WHERE UserOid = @targetUserOid
			  AND DefaultChartId IS NULL;
		`);

	return json({ ok: true });
};
