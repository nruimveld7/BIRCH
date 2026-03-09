import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveHierarchyId } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const activeHierarchyId = await getActiveHierarchyId(cookies);
	const pool = await GetPool();
	const defaultResult = await pool
		.request()
		.input('userOid', user.id)
		.query(`SELECT TOP (1) DefaultHierarchyId FROM dbo.Users WHERE UserOid = @userOid AND DeletedAt IS NULL;`);
	const defaultHierarchyId = (defaultResult.recordset?.[0]?.DefaultHierarchyId as number | null) ?? null;

	const result = await pool
		.request()
		.input('userOid', user.id)
		.input('defaultHierarchyId', defaultHierarchyId)
		.query(`WITH RankedMemberships AS (
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
					ORDER BY CASE r.RoleName WHEN 'Manager' THEN 3 WHEN 'Maintainer' THEN 2 WHEN 'Member' THEN 1 ELSE 0 END DESC,
						hu.GrantedAt DESC
				) AS RoleRank
			FROM dbo.HierarchyUsers hu
			INNER JOIN dbo.Hierarchies h ON h.HierarchyId = hu.HierarchyId
			INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
			WHERE hu.UserOid = @userOid
			  AND hu.DeletedAt IS NULL
			  AND hu.IsActive = 1
			  AND h.DeletedAt IS NULL
			  AND (h.IsActive = 1 OR r.RoleName = 'Manager')
		)
		SELECT HierarchyId, Name, RoleName, IsDefault, IsActive, PlaceholderThemeJson, VersionAt
		FROM RankedMemberships
		WHERE RoleRank = 1
		ORDER BY IsDefault DESC, Name;`);

	const memberships = result.recordset ?? [];
	const resolvedActiveHierarchyId =
		typeof activeHierarchyId === 'number' &&
		memberships.some((membership) => membership.HierarchyId === activeHierarchyId)
			? activeHierarchyId
			: (memberships[0]?.HierarchyId ?? null);

	return json({ memberships, defaultHierarchyId, activeHierarchyId: resolvedActiveHierarchyId });
};
