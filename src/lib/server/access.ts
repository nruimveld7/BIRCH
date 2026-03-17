import { GetPool } from '$lib/server/db';

export type AccessState = {
	hasCharts: boolean;
	hasChartUsers: boolean;
	hasChartAccess: boolean;
	isBootstrap: boolean;
	hasAccess: boolean;
};

export async function getAccessState(userOid: string): Promise<AccessState> {
	const pool = await GetPool();
	const result = await pool
		.request()
		.input('userOid', userOid)
		.query(
			`
			DECLARE @hasBootstrap bit = 0;
			DECLARE @hasChartAccess bit = 0;
			DECLARE @hasCharts bit = 0;
			DECLARE @hasChartUsers bit = 0;

			IF OBJECT_ID('dbo.BootstrapManagers', 'U') IS NOT NULL
			BEGIN
				IF EXISTS (
					SELECT 1 FROM dbo.BootstrapManagers
					WHERE UserOid = @userOid AND DeletedAt IS NULL AND IsActive = 1
				)
				BEGIN
					SET @hasBootstrap = 1;
				END
			END

			IF OBJECT_ID('dbo.ChartUsers', 'U') IS NOT NULL
			BEGIN
				IF EXISTS (
					SELECT 1 FROM dbo.ChartUsers
				)
				BEGIN
					SET @hasChartUsers = 1;
				END

				IF EXISTS (
					SELECT 1
					FROM dbo.ChartUsers hu
					INNER JOIN dbo.Charts h
						ON h.ChartId = hu.ChartId
					LEFT JOIN dbo.Roles r
						ON r.RoleId = hu.RoleId
					WHERE hu.UserOid = @userOid
					  AND (h.IsActive = 1 OR r.RoleName = 'Manager')
				)
				BEGIN
					SET @hasChartAccess = 1;
				END
			END

			IF OBJECT_ID('dbo.Charts', 'U') IS NOT NULL
			BEGIN
				IF EXISTS (SELECT 1 FROM dbo.Charts)
				BEGIN
					SET @hasCharts = 1;
				END
			END

			SELECT
				@hasBootstrap AS HasBootstrap,
				@hasChartAccess AS HasChartAccess,
				@hasCharts AS HasCharts,
				@hasChartUsers AS HasChartUsers;
		`
		);

	const row = result.recordset?.[0];
	const hasCharts = Boolean(row?.HasCharts);
	const hasChartAccess = Boolean(row?.HasChartAccess);
	const isBootstrap = Boolean(row?.HasBootstrap);
	const hasChartUsers = Boolean(row?.HasChartUsers);
	const hasAccess = isBootstrap || hasChartAccess;
	return { hasCharts, hasChartUsers, hasChartAccess, isBootstrap, hasAccess };
}
