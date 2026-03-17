import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { isBootstrapManager, requireChartRole } from '$lib/server/chart-access';

function parseChartId(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw error(400, 'chartId is required');
	return value;
}

function parseIsActive(value: unknown): boolean {
	if (typeof value !== 'boolean') throw error(400, 'isActive is required');
	return value;
}

function parseExpectedVersionAt(value: unknown): string | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string') throw error(400, 'expectedVersionAt is invalid');
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) throw error(400, 'expectedVersionAt is invalid');
	return parsed.toISOString();
}

function parseConfirmDeactivation(value: unknown): boolean {
	if (value === undefined) return false;
	return value === true;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const body = await request.json().catch(() => null);
	const chartId = parseChartId(body?.chartId);
	const isActive = parseIsActive(body?.isActive);
	const expectedVersionAt = parseExpectedVersionAt(body?.expectedVersionAt);
	const confirmDeactivation = parseConfirmDeactivation(body?.confirmDeactivation);
	await requireChartRole({
		userOid: user.id,
		chartId,
		minimumRole: 'Manager',
		message: 'Only managers can change chart state'
	});

	const pool = await GetPool();
	const chartResult = await pool.request().input('chartId', chartId).query(`
		SELECT TOP (1)
			ChartId,
			IsActive,
			COALESCE(UpdatedAt, CreatedAt) AS VersionAt
		FROM dbo.Charts
		WHERE ChartId = @chartId;
	`);
	const chart = chartResult.recordset?.[0] as
		| {
				ChartId: number;
				IsActive: boolean;
				VersionAt: Date | null;
		  }
		| undefined;

	if (!chart) {
		throw error(404, 'Chart not found');
	}

	const currentVersionAtIso = chart.VersionAt ? new Date(chart.VersionAt).toISOString() : null;
	if (expectedVersionAt && currentVersionAtIso && expectedVersionAt !== currentVersionAtIso) {
		return json(
			{
				code: 'CHART_CONCURRENT_MODIFICATION',
				message: 'This chart changed while you were editing. Review the latest values and retry.'
			},
			{ status: 409 }
		);
	}

	const actorIsBootstrapManager = await isBootstrapManager(user.id);

	if (!isActive) {
		const managerCountResult = await pool
			.request()
			.input('chartId', chartId)
			.input('userOid', user.id)
			.query(`
			SELECT
				SUM(CASE WHEN hu.UserOid <> @userOid THEN 1 ELSE 0 END) AS OtherManagerCount
			FROM dbo.ChartUsers hu
			INNER JOIN dbo.Roles r ON r.RoleId = hu.RoleId
			WHERE hu.ChartId = @chartId
			  AND r.RoleName = 'Manager';
		`);
		const otherManagerCount = Number(managerCountResult.recordset?.[0]?.OtherManagerCount ?? 0);

		if (otherManagerCount > 0) {
			const removeResult = await pool
				.request()
				.input('chartId', chartId)
				.input('userOid', user.id)
				.query(`
					BEGIN TRY
						BEGIN TRANSACTION;

						UPDATE dbo.Users
						SET DefaultChartId = NULL,
							UpdatedAt = SYSUTCDATETIME()
						WHERE UserOid = @userOid
						  AND DefaultChartId = @chartId;

						UPDATE dbo.UserSessions
						SET ActiveChartId = NULL
						WHERE UserOid = @userOid
						  AND ActiveChartId = @chartId;

						DELETE cu
						FROM dbo.ChartUsers cu
						WHERE cu.ChartId = @chartId
						  AND cu.UserOid = @userOid;

						SELECT @@ROWCOUNT AS RemovedMembershipCount;

						COMMIT TRANSACTION;
					END TRY
					BEGIN CATCH
						IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
						THROW;
					END CATCH
				`);
			const removedMembershipCount = Number(
				removeResult.recordset?.[0]?.RemovedMembershipCount ?? 0
			);
			if (!actorIsBootstrapManager && removedMembershipCount <= 0) {
				throw error(409, 'Unable to remove your chart access.');
			}

			return json({
				ok: true,
				chartId,
				isActive: chart.IsActive,
				mode: 'manager_removed',
				versionAt: currentVersionAtIso
			});
		}
	}

	if (!isActive && !confirmDeactivation) {
		return json(
			{
				code: 'CHART_DEACTIVATION_CONFIRMATION_REQUIRED',
				action: 'DELETE_CHART',
				managerCount: 0,
				message:
					'This chart and all related data will be permanently deleted. Continue?'
			},
			{ status: 409 }
		);
	}

	if (isActive) {
		const updateResult = await pool
			.request()
			.input('chartId', chartId)
			.input('userOid', user.id)
			.query(`
				UPDATE dbo.Charts
				SET IsActive = 1,
					UpdatedAt = SYSUTCDATETIME(),
					UpdatedBy = @userOid
				OUTPUT INSERTED.ChartId, INSERTED.IsActive, COALESCE(INSERTED.UpdatedAt, INSERTED.CreatedAt) AS VersionAt
				WHERE ChartId = @chartId;
			`);
		const updated = updateResult.recordset?.[0] as
			| {
					ChartId: number;
					IsActive: boolean;
					VersionAt: Date | null;
			  }
			| undefined;
		if (!updated) {
			throw error(404, 'Chart not found');
		}
		return json({
			ok: true,
			chartId: updated.ChartId,
			isActive: updated.IsActive,
			mode: 'chart_state_updated',
			versionAt: updated.VersionAt ? new Date(updated.VersionAt).toISOString() : null
		});
	}

	await pool
		.request()
		.input('chartId', chartId)
		.query(`
			BEGIN TRY
				BEGIN TRANSACTION;

				UPDATE dbo.Users
				SET DefaultChartId = NULL,
					UpdatedAt = SYSUTCDATETIME()
				WHERE DefaultChartId = @chartId;

				UPDATE dbo.UserSessions
				SET ActiveChartId = NULL
				WHERE ActiveChartId = @chartId;

				DELETE c
				FROM dbo.NodeConnections c
				WHERE c.ChartId = @chartId;

				DELETE nu
				FROM dbo.NodeUsers nu
				INNER JOIN dbo.Nodes n ON n.NodeId = nu.NodeId
				WHERE n.ChartId = @chartId;

				DELETE n
				FROM dbo.Nodes n
				WHERE n.ChartId = @chartId;

				DELETE cu
				FROM dbo.ChartUsers cu
				WHERE cu.ChartId = @chartId;

				DELETE ch
				FROM dbo.Charts ch
				WHERE ch.ChartId = @chartId;

				IF OBJECT_ID('dbo.HierarchyUsers', 'U') IS NOT NULL
				BEGIN
					DELETE hu
					FROM dbo.HierarchyUsers hu
					WHERE hu.HierarchyId = @chartId;
				END;

				IF OBJECT_ID('dbo.Hierarchies', 'U') IS NOT NULL
				BEGIN
					DELETE h
					FROM dbo.Hierarchies h
					WHERE h.HierarchyId = @chartId;
				END;

				COMMIT TRANSACTION;
			END TRY
			BEGIN CATCH
				IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
				THROW;
			END CATCH
		`);

	return json({
		ok: true,
		chartId,
		isActive: false,
		mode: 'chart_deleted',
		versionAt: null
	});
};
