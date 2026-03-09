import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { GetPool } from '$lib/server/db';

function parseOidList(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(/[,;\s]+/)
		.map((t) => t.trim())
		.filter(Boolean);
}

export const load: PageServerLoad = async ({ locals }) => {
	const approvedOids = parseOidList(env.BOOTSTRAP_MANAGER_OIDS);
	const currentOid = locals.user?.id ?? null;
	let hasUsers = false;

	try {
		const pool = await GetPool();
		const result = await pool.request().query(`
			IF OBJECT_ID('dbo.Users', 'U') IS NULL
				SELECT CAST(0 AS bit) AS HasUsers;
			ELSE IF EXISTS (SELECT 1 FROM dbo.Users WHERE DeletedAt IS NULL)
				SELECT CAST(1 AS bit) AS HasUsers;
			ELSE
				SELECT CAST(0 AS bit) AS HasUsers;
		`);
		hasUsers = Boolean(result.recordset?.[0]?.HasUsers);
	} catch {
		hasUsers = false;
	}

	return { approvedOids, currentOid, hasUsers };
};
