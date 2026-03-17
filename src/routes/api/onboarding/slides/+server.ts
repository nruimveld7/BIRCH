import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { listEffectiveChartMemberships } from '$lib/server/chart-access';
import { getRoleTier, loadOnboardingSlidesByTierRange, toRoleTier } from '$lib/server/onboarding';

type MembershipRoleRow = { RoleName: 'Member' | 'Maintainer' | 'Manager' };

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		throw error(401, 'Unauthorized');
	}

	const pool = await GetPool();
	const userSettingsResult = await pool
		.request()
		.input('userOid', user.id)
		.query(
			`SELECT TOP (1) OnboardingRole
			 FROM dbo.Users
			 WHERE UserOid = @userOid;`
		);
	const memberships = await listEffectiveChartMemberships({
		userOid: user.id,
		defaultChartId: null
	});

	const currentTier = toRoleTier(userSettingsResult.recordset?.[0]?.OnboardingRole);
	const membershipRows = memberships as MembershipRoleRow[];
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
