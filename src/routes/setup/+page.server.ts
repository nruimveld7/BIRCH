import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { GetPool } from '$lib/server/db';
import { getAccessState } from '$lib/server/access';
import { setActiveChartForSession } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		throw redirect(302, '/auth/login');
	}
	const access = await getAccessState(user.id);
	if (!access.isBootstrap) {
		throw redirect(302, '/');
	}
	return { user };
};

export const actions: Actions = {
	default: async ({ request, locals, cookies }) => {
		const user = locals.user;
		if (!user) {
			throw redirect(302, '/auth/login');
		}
		const access = await getAccessState(user.id);
		if (!access.isBootstrap) {
			throw redirect(302, '/');
		}

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) {
			throw error(400, 'Chart name is required.');
		}

		const pool = await GetPool();
		const requestDb = pool.request();
		requestDb.input(
			'themeJson',
			JSON.stringify({
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
					controlsBackground: '#161a22',
					controlsText: '#ffffff',
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
					controlsBackground: '#f5f6f8',
					controlsText: '#000000',
					placeholder: '#c8102e'
				}
			})
		);
		requestDb.input('name', name);
		requestDb.input('userOid', user.id);

		const result = await requestDb.query(`
			DECLARE @CreatedChart TABLE (ChartId int NOT NULL);
			DECLARE @ChartId int;
			DECLARE @ManagerRoleId int;

			SELECT TOP (1) @ManagerRoleId = RoleId FROM dbo.Roles WHERE RoleName = 'Manager';
			IF @ManagerRoleId IS NULL
			BEGIN
				RAISERROR ('Manager role not found.', 16, 1);
				RETURN;
			END

			INSERT INTO dbo.Charts (Name, PlaceholderThemeJson, CreatedBy)
			OUTPUT INSERTED.ChartId INTO @CreatedChart(ChartId)
			VALUES (@name, @themeJson, @userOid);

			SELECT TOP (1) @ChartId = ChartId
			FROM @CreatedChart;

			IF @ChartId IS NULL
			BEGIN
				RAISERROR ('Failed to capture ChartId for new chart.', 16, 1);
				RETURN;
			END

			INSERT INTO dbo.ChartUsers (ChartId, UserOid, RoleId, GrantedBy)
			VALUES (@ChartId, @userOid, @ManagerRoleId, @userOid);

			UPDATE dbo.Users
			SET DefaultChartId = CASE WHEN DefaultChartId IS NULL THEN @ChartId ELSE DefaultChartId END,
				UpdatedAt = SYSUTCDATETIME()
			WHERE UserOid = @userOid
			  AND DeletedAt IS NULL;

			SELECT @ChartId AS ChartId;
		`);

		const chartId = result.recordset?.[0]?.ChartId;
		if (chartId) {
			await setActiveChartForSession(cookies, chartId);
		}

		throw redirect(303, '/');
	}
};
