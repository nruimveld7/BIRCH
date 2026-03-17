import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveChartId } from '$lib/server/auth';
import { listEffectiveChartMemberships } from '$lib/server/chart-access';

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const activeChartId = await getActiveChartId(cookies);
	const pool = await GetPool();
	const defaultResult = await pool
		.request()
		.input('userOid', user.id)
		.query(`SELECT TOP (1) DefaultChartId FROM dbo.Users WHERE UserOid = @userOid;`);
	const defaultChartId = (defaultResult.recordset?.[0]?.DefaultChartId as number | null) ?? null;

	const memberships = await listEffectiveChartMemberships({
		userOid: user.id,
		defaultChartId
	});
	const resolvedActiveChartId =
		typeof activeChartId === 'number' &&
		memberships.some((membership) => membership.ChartId === activeChartId)
			? activeChartId
			: (memberships[0]?.ChartId ?? null);

	return json({ memberships, defaultChartId, activeChartId: resolvedActiveChartId });
};
