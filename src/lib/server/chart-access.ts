import { error } from '@sveltejs/kit';
import { GetPool } from '$lib/server/db';

export type ChartRole = 'Member' | 'Maintainer' | 'Manager';

export type EffectiveChartMembership = {
	ChartId: number;
	Name: string;
	RoleName: ChartRole;
	AccessRoleLabel: ChartRole | 'Bootstrap';
	IsDefault: boolean;
	IsActive: boolean;
	PlaceholderThemeJson: string | null;
	VersionAt: string | null;
};

const roleRankByName: Record<ChartRole, number> = {
	Member: 1,
	Maintainer: 2,
	Manager: 3
};

function hasRequiredRole(current: ChartRole, minimum: ChartRole): boolean {
	return roleRankByName[current] >= roleRankByName[minimum];
}

function normalizeMembershipRows(rows: Array<Record<string, unknown>>): EffectiveChartMembership[] {
	return rows.map((row) => {
		const rawVersionAt = row.VersionAt;
		const parsedVersionAt =
			rawVersionAt instanceof Date ? rawVersionAt : rawVersionAt ? new Date(String(rawVersionAt)) : null;
		const versionAt =
			parsedVersionAt && !Number.isNaN(parsedVersionAt.getTime())
				? parsedVersionAt.toISOString()
				: null;

		return {
			ChartId: Number(row.ChartId ?? 0),
			Name: String(row.Name ?? ''),
			RoleName:
				row.RoleName === 'Manager' || row.RoleName === 'Maintainer' || row.RoleName === 'Member'
					? row.RoleName
					: 'Member',
			AccessRoleLabel:
				row.AccessRoleLabel === 'Bootstrap' ||
				row.AccessRoleLabel === 'Manager' ||
				row.AccessRoleLabel === 'Maintainer' ||
				row.AccessRoleLabel === 'Member'
					? row.AccessRoleLabel
					: row.RoleName === 'Manager' || row.RoleName === 'Maintainer' || row.RoleName === 'Member'
						? row.RoleName
						: 'Member',
			IsDefault: Boolean(row.IsDefault),
			IsActive: Boolean(row.IsActive),
			PlaceholderThemeJson:
				typeof row.PlaceholderThemeJson === 'string' ? row.PlaceholderThemeJson : null,
			VersionAt: versionAt
		};
	});
}

export async function isBootstrapManager(userOid: string): Promise<boolean> {
	const pool = await GetPool();
	const result = await pool.request().input('userOid', userOid).query(`
		IF OBJECT_ID('dbo.BootstrapManagers', 'U') IS NULL
			SELECT CAST(0 AS bit) AS IsBootstrapManager;
		ELSE IF EXISTS (
			SELECT 1
			FROM dbo.BootstrapManagers
			WHERE UserOid = @userOid
			  AND DeletedAt IS NULL
			  AND IsActive = 1
		)
			SELECT CAST(1 AS bit) AS IsBootstrapManager;
		ELSE
			SELECT CAST(0 AS bit) AS IsBootstrapManager;
	`);
	return Boolean(result.recordset?.[0]?.IsBootstrapManager);
}

export async function getEffectiveChartRole(args: {
	userOid: string;
	chartId: number;
}): Promise<ChartRole | null> {
	const pool = await GetPool();
	if (await isBootstrapManager(args.userOid)) {
		const chartResult = await pool.request().input('chartId', args.chartId).query(`
			SELECT TOP (1) 1 AS ChartExists
			FROM dbo.Charts
			WHERE ChartId = @chartId;
		`);
		return chartResult.recordset?.[0]?.ChartExists ? 'Manager' : null;
	}

	const result = await pool
		.request()
		.input('userOid', args.userOid)
		.input('chartId', args.chartId)
		.query(`
			SELECT TOP (1) r.RoleName
			FROM dbo.ChartUsers hu
			INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
			INNER JOIN dbo.Charts h ON h.ChartId = hu.ChartId
			WHERE hu.UserOid = @userOid
			  AND hu.ChartId = @chartId
			  AND (h.IsActive = 1 OR r.RoleName = 'Manager')
			ORDER BY
				CASE r.RoleName
					WHEN 'Manager' THEN 3
					WHEN 'Maintainer' THEN 2
					WHEN 'Member' THEN 1
					ELSE 0
				END DESC,
				hu.GrantedAt DESC;
		`);

	const roleName = result.recordset?.[0]?.RoleName;
	if (roleName === 'Member' || roleName === 'Maintainer' || roleName === 'Manager') {
		return roleName;
	}
	return null;
}

export async function requireChartRole(args: {
	userOid: string;
	chartId: number;
	minimumRole: ChartRole;
	message?: string;
}): Promise<ChartRole> {
	const roleName = await getEffectiveChartRole({ userOid: args.userOid, chartId: args.chartId });
	if (!roleName || !hasRequiredRole(roleName, args.minimumRole)) {
		throw error(403, args.message ?? 'You do not have access to this chart');
	}
	return roleName;
}

export async function userCanAccessChart(args: {
	userOid: string;
	chartId: number;
}): Promise<boolean> {
	return (await getEffectiveChartRole(args)) !== null;
}

export async function hasGlobalManagerAccess(userOid: string): Promise<boolean> {
	if (await isBootstrapManager(userOid)) {
		return true;
	}

	const pool = await GetPool();
	const result = await pool.request().input('userOid', userOid).query(`
		SELECT TOP (1) 1 AS HasManagerAccess
		FROM dbo.ChartUsers hu
		INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
		INNER JOIN dbo.Charts h ON h.ChartId = hu.ChartId
		WHERE hu.UserOid = @userOid
		  AND r.RoleName = 'Manager'
		  AND h.IsActive = 1;
	`);

	return Boolean(result.recordset?.[0]?.HasManagerAccess);
}

export async function listEffectiveChartMemberships(args: {
	userOid: string;
	defaultChartId: number | null;
}): Promise<EffectiveChartMembership[]> {
	const pool = await GetPool();

	if (await isBootstrapManager(args.userOid)) {
		const result = await pool
			.request()
			.input('userOid', args.userOid)
			.input('defaultChartId', args.defaultChartId)
			.query(`
				WITH RankedDirectMemberships AS (
					SELECT
						hu.ChartId,
						r.RoleName,
						ROW_NUMBER() OVER (
							PARTITION BY hu.ChartId
							ORDER BY
								CASE r.RoleName
									WHEN 'Manager' THEN 3
									WHEN 'Maintainer' THEN 2
									WHEN 'Member' THEN 1
									ELSE 0
								END DESC,
								hu.GrantedAt DESC
						) AS RoleRank
					FROM dbo.ChartUsers hu
					INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
					WHERE hu.UserOid = @userOid
				)
				SELECT
					h.ChartId,
					h.Name,
					CAST('Manager' AS nvarchar(50)) AS RoleName,
					CAST(COALESCE(dm.RoleName, 'Bootstrap') AS nvarchar(50)) AS AccessRoleLabel,
					CAST(CASE WHEN h.ChartId = @defaultChartId THEN 1 ELSE 0 END AS bit) AS IsDefault,
					h.IsActive,
					h.PlaceholderThemeJson,
					COALESCE(h.UpdatedAt, h.CreatedAt) AS VersionAt
				FROM dbo.Charts h
				LEFT JOIN RankedDirectMemberships dm
					ON dm.ChartId = h.ChartId
				   AND dm.RoleRank = 1
				ORDER BY IsDefault DESC, h.Name;
			`);
		return normalizeMembershipRows((result.recordset ?? []) as Array<Record<string, unknown>>);
	}

	const result = await pool
		.request()
		.input('userOid', args.userOid)
		.input('defaultChartId', args.defaultChartId)
		.query(`
			WITH RankedMemberships AS (
				SELECT
					hu.ChartId,
					h.Name,
					r.RoleName,
					r.RoleName AS AccessRoleLabel,
					h.IsActive,
					h.PlaceholderThemeJson,
					COALESCE(h.UpdatedAt, h.CreatedAt) AS VersionAt,
					CAST(CASE WHEN hu.ChartId = @defaultChartId THEN 1 ELSE 0 END AS bit) AS IsDefault,
					ROW_NUMBER() OVER (
						PARTITION BY hu.ChartId
						ORDER BY
							CASE r.RoleName
								WHEN 'Manager' THEN 3
								WHEN 'Maintainer' THEN 2
								WHEN 'Member' THEN 1
								ELSE 0
							END DESC,
							hu.GrantedAt DESC
					) AS RoleRank
				FROM dbo.ChartUsers hu
				INNER JOIN dbo.Charts h ON h.ChartId = hu.ChartId
				INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
				WHERE hu.UserOid = @userOid
				  AND (h.IsActive = 1 OR r.RoleName = 'Manager')
			)
			SELECT ChartId, Name, RoleName, AccessRoleLabel, IsDefault, IsActive, PlaceholderThemeJson, VersionAt
			FROM RankedMemberships
			WHERE RoleRank = 1
			ORDER BY IsDefault DESC, Name;
		`);

	return normalizeMembershipRows((result.recordset ?? []) as Array<Record<string, unknown>>);
}
