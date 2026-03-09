import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { GetPool } from '$lib/server/db';
import { getAccessState } from '$lib/server/access';
import { setActiveHierarchyForSession } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		throw redirect(302, '/auth/login');
	}
	const access = await getAccessState(user.id);
	if (!access.isBootstrap) {
		throw redirect(302, '/');
	}
	return { user };
};

export const actions: Actions = {
	default: async ({ request, locals, cookies }) => {
		const user = locals.user;
		if (!user) {
			throw redirect(302, '/auth/login');
		}
		const access = await getAccessState(user.id);
		if (!access.isBootstrap) {
			throw redirect(302, '/');
		}

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) {
			throw error(400, 'Hierarchy name is required.');
		}

		const pool = await GetPool();
		const requestDb = pool.request();
		requestDb.input(
			'themeJson',
			JSON.stringify({ dark: { placeholder: '#c8102e' }, light: { placeholder: '#c8102e' } })
		);
		requestDb.input('name', name);
		requestDb.input('userOid', user.id);

		const result = await requestDb.query(`
			DECLARE @CreatedHierarchy TABLE (HierarchyId int NOT NULL);
			DECLARE @HierarchyId int;
			DECLARE @ManagerRoleId int;

			INSERT INTO dbo.Hierarchies (Name, PlaceholderThemeJson, CreatedBy)
			OUTPUT INSERTED.HierarchyId INTO @CreatedHierarchy(HierarchyId)
			VALUES (@name, @themeJson, @userOid);

			SELECT TOP (1) @HierarchyId = HierarchyId
			FROM @CreatedHierarchy;

			IF @HierarchyId IS NULL
			BEGIN
				RAISERROR ('Failed to capture HierarchyId for new hierarchy.', 16, 1);
				RETURN;
			END

			SELECT TOP (1) @ManagerRoleId = RoleId FROM dbo.Roles WHERE RoleName = 'Manager';

			IF @ManagerRoleId IS NULL
			BEGIN
				RAISERROR ('Manager role not found.', 16, 1);
				RETURN;
			END

			INSERT INTO dbo.HierarchyUsers (HierarchyId, UserOid, RoleId, GrantedBy)
			VALUES (@HierarchyId, @userOid, @ManagerRoleId, @userOid);

			UPDATE dbo.Users
			SET DefaultHierarchyId = CASE WHEN DefaultHierarchyId IS NULL THEN @HierarchyId ELSE DefaultHierarchyId END,
				UpdatedAt = SYSUTCDATETIME()
			WHERE UserOid = @userOid
			  AND DeletedAt IS NULL;

			SELECT @HierarchyId AS HierarchyId;
		`);

		const hierarchyId = result.recordset?.[0]?.HierarchyId;
		if (hierarchyId) {
			await setActiveHierarchyForSession(cookies, hierarchyId);
		}

		throw redirect(303, '/');
	}
};
