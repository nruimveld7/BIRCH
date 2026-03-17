import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setActiveChartForSession } from '$lib/server/auth';
import { userCanAccessChart } from '$lib/server/chart-access';

function parseChartId(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw error(400, 'A valid chartId is required');
	}
	return value;
}

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const body = await request.json().catch(() => null);
	const chartId = parseChartId(body?.chartId);

	if (!(await userCanAccessChart({ userOid: user.id, chartId }))) {
		throw error(403, 'You do not have access to this chart');
	}

	await setActiveChartForSession(cookies, chartId);
	return json({ ok: true, activeChartId: chartId });
};
