import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveScheduleId } from '$lib/server/auth';

type ScheduleRole = 'Member' | 'Maintainer' | 'Manager';
type ScheduleMembership = {
	ScheduleId: number;
	Name: string;
	RoleName: ScheduleRole;
	IsDefault: boolean;
	IsActive: boolean;
	ThemeJson: string | null;
	VersionAt: string | Date;
};

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const user = locals.user;
	if (!user) {
		throw error(401, 'Unauthorized');
	}

	const activeScheduleId = await getActiveScheduleId(cookies);
	const pool = await GetPool();

	const defaultResult = await pool
		.request()
		.input('userOid', user.id)
		.query(
			`SELECT TOP (1) DefaultScheduleId
			 FROM dbo.Users
			 WHERE UserOid = @userOid
			   AND DeletedAt IS NULL;`
		);

	const defaultScheduleId = (defaultResult.recordset?.[0]?.DefaultScheduleId as number | null) ?? null;

	const result = await pool
		.request()
		.input('userOid', user.id)
		.input('defaultScheduleId', defaultScheduleId)
		.query(
			`WITH RankedMemberships AS (
				SELECT
					su.ScheduleId,
					s.Name,
					r.RoleName,
					s.IsActive,
					s.ThemeJson,
					COALESCE(s.UpdatedAt, s.CreatedAt) AS VersionAt,
					CAST(CASE WHEN su.ScheduleId = @defaultScheduleId THEN 1 ELSE 0 END AS bit) AS IsDefault,
					ROW_NUMBER() OVER (
						PARTITION BY su.ScheduleId
						ORDER BY
							CASE r.RoleName
								WHEN 'Manager' THEN 3
								WHEN 'Maintainer' THEN 2
								WHEN 'Member' THEN 1
								ELSE 0
							END DESC,
							su.GrantedAt DESC
					) AS RoleRank
				FROM dbo.ScheduleUsers su
				INNER JOIN dbo.Schedules s
					ON s.ScheduleId = su.ScheduleId
				INNER JOIN dbo.Roles r
					ON r.RoleId = su.RoleId
				WHERE su.UserOid = @userOid
				  AND su.DeletedAt IS NULL
				  AND su.IsActive = 1
				  AND s.DeletedAt IS NULL
				  AND (s.IsActive = 1 OR r.RoleName = 'Manager')
			)
			SELECT ScheduleId, Name, RoleName, IsDefault, IsActive, ThemeJson, VersionAt
			FROM RankedMemberships
			WHERE RoleRank = 1
			ORDER BY IsDefault DESC, Name;`
		);

	const memberships = (result.recordset ?? []) as ScheduleMembership[];
	const resolvedActiveScheduleId =
		activeScheduleId !== null &&
		memberships.some((membership) => membership.ScheduleId === activeScheduleId)
			? activeScheduleId
			: (memberships[0]?.ScheduleId ?? null);

	return json({
		activeScheduleId: resolvedActiveScheduleId,
		defaultScheduleId,
		memberships
	});
};
