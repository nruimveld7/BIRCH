import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';

export const GET: RequestHandler = async ({ url }) => {
	const scheduleId = Number(url.searchParams.get('scheduleId'));
	const start = url.searchParams.get('start');
	const end = url.searchParams.get('end');

	if (!scheduleId || !start || !end) {
		throw error(400, 'Missing scheduleId, start, or end');
	}

	const pool = await GetPool();
	const request = pool.request();
	request.input('scheduleId', scheduleId);
	request.input('start', start);
	request.input('end', end);

	const result = await request.query(`
        SELECT * FROM dbo.Schedules WHERE ScheduleId = @scheduleId AND DeletedAt IS NULL;

        SELECT * FROM dbo.Patterns WHERE ScheduleId = @scheduleId AND DeletedAt IS NULL;
        SELECT * FROM dbo.Shifts WHERE ScheduleId = @scheduleId AND DeletedAt IS NULL ORDER BY DisplayOrder;
		SELECT * FROM dbo.ShiftEdits
		WHERE ScheduleId = @scheduleId
		  AND DeletedAt IS NULL
		  AND IsActive = 1
		  AND StartDate <= @end
		  AND (EndDate IS NULL OR EndDate >= @start)
		ORDER BY ShiftId, StartDate;
        SELECT * FROM dbo.EventCodes WHERE ScheduleId = @scheduleId AND DeletedAt IS NULL ORDER BY SortOrder;

        SELECT * FROM dbo.ScheduleUsers WHERE ScheduleId = @scheduleId AND DeletedAt IS NULL;

        SELECT * FROM dbo.ScheduleAssignments
        WHERE ScheduleId = @scheduleId
          AND DeletedAt IS NULL
          AND StartDate <= @end
          AND (EndDate IS NULL OR EndDate >= @start)
        ORDER BY ShiftId, UserOid, StartDate;

        SELECT * FROM dbo.ScheduleEvents
        WHERE ScheduleId = @scheduleId
          AND DeletedAt IS NULL
          AND StartDate <= @end
          AND EndDate >= @start;
    `);

	const [
		schedules,
		patterns,
		employeeTypes,
		employeeTypeVersions,
		coverageCodes,
		scheduleUsers,
		scheduleUserTypes,
		scheduleEvents
	] = result.recordsets;

	return json({
		schedule: schedules?.[0] ?? null,
		patterns,
		employeeTypes,
		employeeTypeVersions,
		coverageCodes,
		scheduleUsers,
		scheduleUserTypes,
		scheduleEvents
	});
};
