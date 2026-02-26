import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { getRoleTier, loadOnboardingSlidesByTierRange, toRoleTier } from '$lib/server/onboarding';

type MembershipRoleRow = { RoleName: 'Member' | 'Maintainer' | 'Manager' };

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		throw error(401, 'Unauthorized');
	}

	const pool = await GetPool();
	const [userSettingsResult, membershipsResult] = await Promise.all([
		pool
			.request()
			.input('userOid', user.id)
			.query(
				`SELECT TOP (1) OnboardingRole
				 FROM dbo.Users
				 WHERE UserOid = @userOid
				   AND DeletedAt IS NULL;`
			),
		pool
			.request()
			.input('userOid', user.id)
			.query(
				`WITH RankedMemberships AS (
					SELECT
						r.RoleName,
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
				SELECT RoleName
				FROM RankedMemberships
				WHERE RoleRank = 1;`
			)
	]);

	const currentTier = toRoleTier(userSettingsResult.recordset?.[0]?.OnboardingRole);
	const membershipRows = (membershipsResult.recordset ?? []) as MembershipRoleRow[];
	const targetTier = Math.max(0, ...membershipRows.map((row) => getRoleTier(row.RoleName)));
	const slides = await loadOnboardingSlidesByTierRange({
		minExclusiveTier: 0,
		maxInclusiveTier: targetTier
	});

	return json({
		currentTier,
		targetTier,
		slides
	});
};
