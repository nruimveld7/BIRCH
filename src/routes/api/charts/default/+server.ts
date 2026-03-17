import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { userCanAccessChart } from '$lib/server/chart-access';

function parseChartId(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw error(400, 'A valid chartId is required');
	}
	return value;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const body = await request.json().catch(() => null);
	const chartId = parseChartId(body?.chartId);
	if (!(await userCanAccessChart({ userOid: user.id, chartId }))) {
		throw error(403, 'You do not have access to this chart');
	}

	const pool = await GetPool();
	await pool.request().input('userOid', user.id).input('defaultChartId', chartId).query(`
		UPDATE dbo.Users
		SET DefaultChartId = @defaultChartId,
			UpdatedAt = SYSUTCDATETIME()
		WHERE UserOid = @userOid;
	`);

	return json({ ok: true, defaultChartId: chartId });
};
