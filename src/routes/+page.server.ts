import type { PageServerLoad } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveHierarchyId, setActiveHierarchyForSession } from '$lib/server/auth';
import {
	getRoleTier,
	loadOnboardingSlidesByTierRange,
	toRoleTier,
	type OnboardingSlide
} from '$lib/server/onboarding';

type HierarchyRole = 'Member' | 'Maintainer' | 'Manager';

type HierarchyMembership = {
	HierarchyId: number;
	Name: string;
	RoleName: HierarchyRole;
	IsDefault: boolean;
	IsActive: boolean;
	PlaceholderThemeJson: string | null;
	VersionAt: string | Date;
};

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const user = locals.user;
	if (!user) {
		return {
			hierarchy: null,
			userRole: null,
			hierarchyMemberships: [] as HierarchyMembership[],
			currentUserOid: null,
			onboarding: {
				currentTier: 0,
				targetTier: 0,
				slides: [] as OnboardingSlide[]
			}
		};
	}

	let hierarchyId = await getActiveHierarchyId(cookies);
	const pool = await GetPool();

	const userSettingsResult = await pool
		.request()
		.input('userOid', user.id)
		.query(
			`SELECT TOP (1) DefaultHierarchyId, OnboardingRole
			 FROM dbo.Users
			 WHERE UserOid = @userOid
			   AND DeletedAt IS NULL;`
		);

	const defaultHierarchyId =
		(userSettingsResult.recordset?.[0]?.DefaultHierarchyId as number | null) ?? null;
	const onboardingRole = toRoleTier(userSettingsResult.recordset?.[0]?.OnboardingRole);

	const membershipsResult = await pool
		.request()
		.input('userOid', user.id)
		.input('defaultHierarchyId', defaultHierarchyId)
		.query(
			`WITH RankedMemberships AS (
				SELECT
					hu.HierarchyId,
					h.Name,
					r.RoleName,
					h.IsActive,
					h.PlaceholderThemeJson,
					COALESCE(h.UpdatedAt, h.CreatedAt) AS VersionAt,
					CAST(CASE WHEN hu.HierarchyId = @defaultHierarchyId THEN 1 ELSE 0 END AS bit) AS IsDefault,
					ROW_NUMBER() OVER (
						PARTITION BY hu.HierarchyId
						ORDER BY
							CASE r.RoleName
								WHEN 'Manager' THEN 3
								WHEN 'Maintainer' THEN 2
								WHEN 'Member' THEN 1
								ELSE 0
							END DESC,
							hu.GrantedAt DESC
					) AS RoleRank
				FROM dbo.HierarchyUsers hu
				INNER JOIN dbo.Hierarchies h
					ON h.HierarchyId = hu.HierarchyId
				INNER JOIN dbo.Roles r
					ON r.RoleId = hu.RoleId
				WHERE hu.UserOid = @userOid
				  AND hu.DeletedAt IS NULL
				  AND hu.IsActive = 1
				  AND h.DeletedAt IS NULL
				  AND (h.IsActive = 1 OR r.RoleName = 'Manager')
			)
			SELECT HierarchyId, Name, RoleName, IsDefault, IsActive, PlaceholderThemeJson, VersionAt
			FROM RankedMemberships
			WHERE RoleRank = 1
			ORDER BY IsDefault DESC, Name;`
		);

	const hierarchyMemberships = (membershipsResult.recordset ?? []) as HierarchyMembership[];

	if (hierarchyId && !hierarchyMemberships.some((membership) => membership.HierarchyId === hierarchyId)) {
		hierarchyId = null;
	}

	if (!hierarchyId) {
		hierarchyId = hierarchyMemberships[0]?.HierarchyId ?? null;
		if (hierarchyId) {
			await setActiveHierarchyForSession(cookies, hierarchyId);
		}
	}

	const highestRoleTier = Math.max(
		0,
		...hierarchyMemberships.map((membership) => getRoleTier(membership.RoleName))
	);
	const onboardingSlides = await loadOnboardingSlidesByTierRange({
		minExclusiveTier: onboardingRole,
		maxInclusiveTier: highestRoleTier
	});

	const activeMembership = hierarchyMemberships.find(
		(membership) => membership.HierarchyId === hierarchyId
	);

	return {
		hierarchy: activeMembership
			? { HierarchyId: activeMembership.HierarchyId, Name: activeMembership.Name }
			: null,
		userRole: activeMembership?.RoleName ?? null,
		hierarchyMemberships,
		currentUserOid: user.id,
		onboarding: {
			currentTier: onboardingRole,
			targetTier: highestRoleTier,
			slides: onboardingSlides as OnboardingSlide[]
		}
	};
};
