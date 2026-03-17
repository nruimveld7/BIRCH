import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { setActiveChartForSession } from '$lib/server/auth';
import { hasGlobalManagerAccess } from '$lib/server/chart-access';

function parseChartName(value: unknown): string {
	if (typeof value !== 'string') throw error(400, 'A valid chartName is required');
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 200) throw error(400, 'chartName must be between 1 and 200 characters');
	return trimmed;
}

const defaultThemeJson = JSON.stringify({
	dark: {
		background: '#07080b',
		text: '#ffffff',
		accent: '#c8102e',
		pageBorderColor: '#292a30',
		primaryGradient1: '#7a1b2c',
		primaryGradient2: '#2d1118',
		secondaryGradient1: '#361219',
		secondaryGradient2: '#0c0e12',
		canvasColor: '#0b0d12',
		canvasAccent: '#c8102e',
		nodeBackground: '#161a22',
		nodeBorder: '#292a30',
		nodeConnections: '#c8102e',
		nodeText: '#ffffff',
		placeholder: '#c8102e'
	},
	light: {
		background: '#f2f3f5',
		text: '#000000',
		accent: '#c8102e',
		pageBorderColor: '#bbbec6',
		primaryGradient1: '#f4d7dd',
		primaryGradient2: '#f8f9fb',
		secondaryGradient1: '#faeef0',
		secondaryGradient2: '#f5f6f8',
		canvasColor: '#edf0f4',
		canvasAccent: '#c8102e',
		nodeBackground: '#f5f6f8',
		nodeBorder: '#bbbec6',
		nodeConnections: '#c8102e',
		nodeText: '#000000',
		placeholder: '#c8102e'
	}
});

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const body = await request.json().catch(() => null);
	const chartName = parseChartName(body?.chartName);
	if (!(await hasGlobalManagerAccess(user.id))) {
		throw error(403, 'Only managers can create charts');
	}

	const pool = await GetPool();
	const createResult = await pool
		.request()
		.input('chartName', chartName)
		.input('themeJson', defaultThemeJson)
		.input('userOid', user.id)
		.query(`
			DECLARE @CreatedChart TABLE (ChartId int NOT NULL);
			DECLARE @ChartId int;
			DECLARE @ManagerRoleId int;

			SELECT TOP (1) @ManagerRoleId = RoleId FROM dbo.Roles WHERE RoleName = 'Manager';
			IF @ManagerRoleId IS NULL THROW 50000, 'Manager role not found', 1;

			INSERT INTO dbo.Charts (Name, PlaceholderThemeJson, CreatedBy)
			OUTPUT INSERTED.ChartId INTO @CreatedChart(ChartId)
			VALUES (@chartName, @themeJson, @userOid);

			SELECT TOP (1) @ChartId = ChartId FROM @CreatedChart;
			IF @ChartId IS NULL THROW 50000, 'Failed to create chart', 1;

			INSERT INTO dbo.ChartUsers (ChartId, UserOid, RoleId, GrantedBy)
			VALUES (@ChartId, @userOid, @ManagerRoleId, @userOid);

			SELECT @ChartId AS ChartId;
		`);

	const chartId = createResult.recordset?.[0]?.ChartId;
	if (typeof chartId !== 'number') throw error(500, 'Failed to create chart');

	await setActiveChartForSession(cookies, chartId);
	return json({
		ok: true,
		chartId,
		activeChartId: chartId
	});
};
