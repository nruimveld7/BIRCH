import type { PageServerLoad } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveChartId, setActiveChartForSession } from '$lib/server/auth';
import { listEffectiveChartMemberships } from '$lib/server/chart-access';
import {
	getRoleTier,
	loadOnboardingSlidesByTierRange,
	toRoleTier,
	type OnboardingSlide
} from '$lib/server/onboarding';

type ChartRole = 'Member' | 'Maintainer' | 'Manager';

type ChartMembership = {
	ChartId: number;
	Name: string;
	RoleName: ChartRole;
	AccessRoleLabel?: ChartRole | 'Bootstrap';
	IsDefault: boolean;
	IsActive: boolean;
	PlaceholderThemeJson: string | null;
	VersionAt: string | null;
};

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const user = locals.user;
	if (!user) {
		return {
			chart: null,
			userRole: null,
			chartMemberships: [] as ChartMembership[],
			currentUserOid: null,
			onboarding: {
				currentTier: 0,
				targetTier: 0,
				slides: [] as OnboardingSlide[]
			}
		};
	}

	let chartId = await getActiveChartId(cookies);
	const pool = await GetPool();

	const userSettingsResult = await pool
		.request()
		.input('userOid', user.id)
		.query(
			`SELECT TOP (1) DefaultChartId, OnboardingRole
			 FROM dbo.Users
			 WHERE UserOid = @userOid;`
		);

	const defaultChartId =
		(userSettingsResult.recordset?.[0]?.DefaultChartId as number | null) ?? null;
	const onboardingRole = toRoleTier(userSettingsResult.recordset?.[0]?.OnboardingRole);

	const chartMemberships = (await listEffectiveChartMemberships({
		userOid: user.id,
		defaultChartId
	})) as ChartMembership[];

	if (chartId && !chartMemberships.some((membership) => membership.ChartId === chartId)) {
		chartId = null;
	}

	if (!chartId) {
		chartId = chartMemberships[0]?.ChartId ?? null;
		if (chartId) {
			await setActiveChartForSession(cookies, chartId);
		}
	}

	const highestRoleTier = Math.max(
		0,
		...chartMemberships.map((membership) => getRoleTier(membership.RoleName))
	);
	const onboardingSlides = await loadOnboardingSlidesByTierRange({
		minExclusiveTier: onboardingRole,
		maxInclusiveTier: highestRoleTier
	});

	const activeMembership = chartMemberships.find(
		(membership) => membership.ChartId === chartId
	);

	return {
		chart: activeMembership
			? { ChartId: activeMembership.ChartId, Name: activeMembership.Name }
			: null,
		userRole: activeMembership?.RoleName ?? null,
		chartMemberships,
		currentUserOid: user.id,
		onboarding: {
			currentTier: onboardingRole,
			targetTier: highestRoleTier,
			slides: onboardingSlides as OnboardingSlide[]
		}
	};
};
