import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';

function parseOnboardingRoleTier(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
		throw error(400, 'onboardingRole must be an integer between 0 and 3');
	}
	return parsed;
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) {
		throw error(401, 'Unauthorized');
	}

	const body = await request.json().catch(() => null);
	const onboardingRole = parseOnboardingRoleTier(body?.onboardingRole);

	const pool = await GetPool();
	await pool
		.request()
		.input('userOid', user.id)
		.input('onboardingRole', onboardingRole)
		.query(
			`MERGE dbo.Users AS target
			 USING (
				SELECT @userOid AS UserOid, CAST(@onboardingRole AS tinyint) AS OnboardingRole
			 ) AS source
			 ON target.UserOid = source.UserOid
			 WHEN MATCHED THEN
			   UPDATE SET OnboardingRole = CASE
						   WHEN target.OnboardingRole > source.OnboardingRole
						   THEN target.OnboardingRole
						   ELSE source.OnboardingRole
						 END,
						  IsActive = 1,
						  DeletedAt = NULL,
						  DeletedBy = NULL,
						  UpdatedAt = SYSUTCDATETIME()
			 WHEN NOT MATCHED THEN
			   INSERT (UserOid, OnboardingRole)
			   VALUES (source.UserOid, source.OnboardingRole);`
		);

	return json({ ok: true, onboardingRole });
};
