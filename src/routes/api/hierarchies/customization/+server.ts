import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';

function parseHierarchyId(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw error(400, 'hierarchyId is required');
	return value;
}

function parseHierarchyName(value: unknown): string {
	if (typeof value !== 'string') throw error(400, 'hierarchyName is required');
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 200) throw error(400, 'hierarchyName must be 1-200 chars');
	return trimmed;
}

function normalizeHex(value: unknown, fallback = '#c8102e'): string {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	if (/^#([0-9a-f]{6})$/i.test(trimmed)) return trimmed.toLowerCase();
	return fallback;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const body = await request.json().catch(() => null);
	const hierarchyId = parseHierarchyId(body?.hierarchyId);
	const hierarchyName = parseHierarchyName(body?.hierarchyName);
	const darkPlaceholder = normalizeHex(body?.placeholderTheme?.dark?.placeholder);
	const lightPlaceholder = normalizeHex(body?.placeholderTheme?.light?.placeholder);
	const placeholderThemeJson = JSON.stringify({
		dark: { placeholder: darkPlaceholder },
		light: { placeholder: lightPlaceholder }
	});

	const pool = await GetPool();
	const managerResult = await pool.request().input('userOid', user.id).input('hierarchyId', hierarchyId).query(`
		SELECT TOP (1) 1 AS IsManager
		FROM dbo.HierarchyUsers hu
		INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
		WHERE hu.UserOid = @userOid
		  AND hu.HierarchyId = @hierarchyId
		  AND hu.IsActive = 1
		  AND hu.DeletedAt IS NULL
		  AND r.RoleName = 'Manager';
	`);

	if (!managerResult.recordset?.[0]?.IsManager) {
		throw error(403, 'Only hierarchy managers can update customization');
	}

	await pool
		.request()
		.input('hierarchyId', hierarchyId)
		.input('hierarchyName', hierarchyName)
		.input('placeholderThemeJson', placeholderThemeJson)
		.input('userOid', user.id)
		.query(`
			UPDATE dbo.Hierarchies
			SET Name = @hierarchyName,
				PlaceholderThemeJson = @placeholderThemeJson,
				UpdatedAt = SYSUTCDATETIME(),
				UpdatedBy = @userOid
			WHERE HierarchyId = @hierarchyId
			  AND DeletedAt IS NULL;
		`);

	return json({
		ok: true,
		hierarchyId,
		hierarchyName,
		placeholderTheme: { dark: { placeholder: darkPlaceholder }, light: { placeholder: lightPlaceholder } }
	});
};
