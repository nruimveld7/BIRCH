import { error, json, type Cookies } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveChartId } from '$lib/server/auth';
import { requireChartRole } from '$lib/server/chart-access';

type RoleName = 'Member' | 'Maintainer' | 'Manager';

async function getActorContext(userOid: string, cookies: Cookies) {
	const chartId = await getActiveChartId(cookies);
	if (!chartId) throw error(400, 'No active chart selected');
	const roleName = (await requireChartRole({
		userOid,
		chartId,
		minimumRole: 'Member',
		message: 'You do not have access to this chart'
	})) as RoleName;
	return { chartId, roleName };
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
			.input('chartId', ctx.chartId)
			.input('targetUserOid', targetUserOid)
			.input('roleId', roleId)
			.query(`
				UPDATE dbo.ChartUsers
				SET RoleId = @roleId
				WHERE ChartId = @chartId
				  AND UserOid = @targetUserOid;
			`);
	}

	if (deactivate) {
		const managerCountResult = await pool.request().input('chartId', ctx.chartId).query(`
			SELECT COUNT_BIG(*) AS ManagerCount
			FROM dbo.ChartUsers hu
			INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
			WHERE hu.ChartId = @chartId
			  AND r.RoleName = 'Manager';
		`);
		const managerCount = Number(managerCountResult.recordset?.[0]?.ManagerCount ?? 0);
		const targetRoleResult = await pool
			.request()
			.input('chartId', ctx.chartId)
			.input('targetUserOid', targetUserOid)
			.query(`
				SELECT TOP (1) r.RoleName
				FROM dbo.ChartUsers hu
				INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
				WHERE hu.ChartId = @chartId
				  AND hu.UserOid = @targetUserOid;
			`);
		if (targetRoleResult.recordset?.[0]?.RoleName === 'Manager' && managerCount <= 1) {
			throw error(400, 'At least one Manager is required for the chart');
		}

		await pool
			.request()
			.input('chartId', ctx.chartId)
			.input('targetUserOid', targetUserOid)
			.query(`
				DELETE FROM dbo.ChartUsers
				WHERE ChartId = @chartId
				  AND UserOid = @targetUserOid;
			`);
	}

	return json({ ok: true });
};
