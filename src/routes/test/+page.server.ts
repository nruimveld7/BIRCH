import type { PageServerLoad } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveScheduleId, setActiveScheduleForSession } from '$lib/server/auth';
import {
	getRoleTier,
	loadOnboardingSlidesByTierRange,
	toRoleTier,
	type OnboardingSlide,
	type ScheduleRole
} from '$lib/server/onboarding';
import {
	parseCollapsedGroupsBySchedule,
	parseThemePreference,
	type ThemePreference
} from '$lib/server/schedule-ui-state';

type ScheduleMembership = {
	ScheduleId: number;
	Name: string;
	RoleName: ScheduleRole;
	IsDefault: boolean;
	IsActive: boolean;
	ThemeJson: string | null;
	VersionAt: string | Date;
};

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const user = locals.user;
	if (!user) {
		return {
			schedule: null,
			userRole: null,
			scheduleMemberships: [] as ScheduleMembership[],
			currentUserOid: null,
			collapsedGroupsBySchedule: {},
			themePreference: 'system' as ThemePreference,
			onboarding: {
				currentTier: 0,
				targetTier: 0,
				slides: [] as OnboardingSlide[]
			}
		};
	}

	let scheduleId = await getActiveScheduleId(cookies);
	const pool = await GetPool();
	const userSettingsResult = await pool
		.request()
		.input('userOid', user.id)
		.query(
			`SELECT TOP (1) DefaultScheduleId, ScheduleUiStateJson, OnboardingRole
			 FROM dbo.Users
			 WHERE UserOid = @userOid
			   AND DeletedAt IS NULL;`
		);
	const defaultScheduleId =
		(userSettingsResult.recordset?.[0]?.DefaultScheduleId as number | null) ?? null;
	const onboardingRole = toRoleTier(userSettingsResult.recordset?.[0]?.OnboardingRole);
	const collapsedGroupsBySchedule = parseCollapsedGroupsBySchedule(
		(userSettingsResult.recordset?.[0]?.ScheduleUiStateJson as string | null) ?? null
	);
	const themePreference = parseThemePreference(
		(userSettingsResult.recordset?.[0]?.ScheduleUiStateJson as string | null) ?? null
	);

	const membershipsResult = await pool
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

	const scheduleMemberships = (membershipsResult.recordset ?? []) as ScheduleMembership[];

	if (
		scheduleId &&
		!scheduleMemberships.some((membership) => membership.ScheduleId === scheduleId)
	) {
		scheduleId = null;
	}

	if (!scheduleId) {
		scheduleId = scheduleMemberships[0]?.ScheduleId ?? null;
		if (scheduleId) {
			await setActiveScheduleForSession(cookies, scheduleId);
		}
	}

	if (!scheduleId) {
		const highestRoleTier = Math.max(
			0,
			...scheduleMemberships.map((membership) => getRoleTier(membership.RoleName))
		);
		const onboardingSlides = await loadOnboardingSlidesByTierRange({
			minExclusiveTier: onboardingRole,
			maxInclusiveTier: highestRoleTier
		});
		return {
			schedule: null,
			userRole: null,
			scheduleMemberships,
			currentUserOid: user.id,
			collapsedGroupsBySchedule,
			themePreference,
			onboarding: {
				currentTier: onboardingRole,
				targetTier: highestRoleTier,
				slides: onboardingSlides
			}
		};
	}
	const activeMembership = scheduleMemberships.find(
		(membership) => membership.ScheduleId === scheduleId
	);
	const highestRoleTier = Math.max(
		0,
		...scheduleMemberships.map((membership) => getRoleTier(membership.RoleName))
	);
	const onboardingSlides = await loadOnboardingSlidesByTierRange({
		minExclusiveTier: onboardingRole,
		maxInclusiveTier: highestRoleTier
	});

	return {
		schedule: activeMembership
			? { ScheduleId: activeMembership.ScheduleId, Name: activeMembership.Name }
			: null,
		userRole: activeMembership?.RoleName ?? null,
		scheduleMemberships,
		currentUserOid: user.id,
		collapsedGroupsBySchedule,
		themePreference,
		onboarding: {
			currentTier: onboardingRole,
			targetTier: highestRoleTier,
			slides: onboardingSlides as OnboardingSlide[]
		}
	};
};
