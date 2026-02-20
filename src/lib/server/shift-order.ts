import { error } from '@sveltejs/kit';
import sql from 'mssql';

type SqlRunner = sql.ConnectionPool | sql.Transaction;

function createRequest(runner: SqlRunner): sql.Request {
	// mssql types do not accept a union argument, but both pool and transaction are valid at runtime.
	return new sql.Request(runner as sql.Transaction);
}

function toSqlDateValue(dateOnly: string): Date {
	const [yearText, monthText, dayText] = dateOnly.split('-');
	return new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
}

export function isDateOnly(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [yearText, monthText, dayText] = value.split('-');
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	if (Number.isNaN(parsed.getTime())) return false;
	return (
		parsed.getUTCFullYear() === year &&
		parsed.getUTCMonth() + 1 === month &&
		parsed.getUTCDate() === day
	);
}

export function monthStartForDate(value: string): string {
	if (!isDateOnly(value)) {
		throw error(400, 'Date must be in YYYY-MM-DD format');
	}
	return `${value.slice(0, 7)}-01`;
}

export function monthEndForMonthStart(monthStart: string): string {
	if (!isDateOnly(monthStart) || !monthStart.endsWith('-01')) {
		throw error(400, 'Month start must be in YYYY-MM-DD format and represent day 1');
	}
	const parsed = new Date(`${monthStart}T00:00:00Z`);
	return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0))
		.toISOString()
		.slice(0, 10);
}

export function cleanMonthValue(value: unknown, label = 'month'): string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value.trim())) {
		throw error(400, `${label} must be in YYYY-MM format`);
	}
	const month = `${value.trim()}-01`;
	if (!isDateOnly(month)) {
		throw error(400, `${label} is invalid`);
	}
	return month;
}

export async function getActiveShiftIdsForMonth(params: {
	runner: SqlRunner;
	scheduleId: number;
	monthStart: string;
}): Promise<number[]> {
	const monthEnd = monthEndForMonthStart(params.monthStart);
	const result = await createRequest(params.runner)
		.input('scheduleId', params.scheduleId)
		.input('monthStart', sql.Date, toSqlDateValue(params.monthStart))
		.input('monthEnd', sql.Date, toSqlDateValue(monthEnd))
		.query(
			`SELECT DISTINCT etv.EmployeeTypeId
			 FROM dbo.EmployeeTypeVersions etv
			 INNER JOIN dbo.EmployeeTypes et
			   ON et.EmployeeTypeId = etv.EmployeeTypeId
			  AND et.ScheduleId = etv.ScheduleId
			  AND et.IsActive = 1
			  AND et.DeletedAt IS NULL
			 WHERE etv.ScheduleId = @scheduleId
			   AND etv.IsActive = 1
			   AND etv.DeletedAt IS NULL
			   AND etv.StartDate <= @monthEnd
			   AND (etv.EndDate IS NULL OR etv.EndDate >= @monthStart);`
		);
	return (result.recordset as Array<{ EmployeeTypeId: number }>).map((row) => Number(row.EmployeeTypeId));
}

export async function resolveShiftOrderForMonth(params: {
	runner: SqlRunner;
	scheduleId: number;
	monthStart: string;
	activeShiftIds: number[];
	fallbackOrderedIds: number[];
}): Promise<number[]> {
	const activeSet = new Set(params.activeShiftIds);
	if (activeSet.size === 0) return [];

	const monthRow = await createRequest(params.runner)
		.input('scheduleId', params.scheduleId)
		.input('monthStart', sql.Date, toSqlDateValue(params.monthStart))
		.query(
			`SELECT TOP (1) EffectiveMonth
			 FROM dbo.ShiftOrderMonths
			 WHERE ScheduleId = @scheduleId
			   AND EffectiveMonth <= @monthStart
			 ORDER BY EffectiveMonth DESC;`
		);
	const resolvedMonth = monthRow.recordset?.[0]?.EffectiveMonth as Date | string | undefined;
	const orderedFromSnapshot: number[] = [];
	if (resolvedMonth) {
		const snapshotRows = await createRequest(params.runner)
			.input('scheduleId', params.scheduleId)
			.input('effectiveMonth', sql.Date, new Date(resolvedMonth))
			.query(
				`SELECT EmployeeTypeId
				 FROM dbo.ShiftOrderMonthItems
				 WHERE ScheduleId = @scheduleId
				   AND EffectiveMonth = @effectiveMonth
				 ORDER BY DisplayOrder ASC, EmployeeTypeId ASC;`
			);
		for (const row of snapshotRows.recordset as Array<{ EmployeeTypeId: number }>) {
			const id = Number(row.EmployeeTypeId);
			if (activeSet.has(id) && !orderedFromSnapshot.includes(id)) {
				orderedFromSnapshot.push(id);
			}
		}
	}

	for (const id of params.fallbackOrderedIds) {
		if (activeSet.has(id) && !orderedFromSnapshot.includes(id)) {
			orderedFromSnapshot.push(id);
		}
	}

	for (const id of params.activeShiftIds) {
		if (!orderedFromSnapshot.includes(id)) {
			orderedFromSnapshot.push(id);
		}
	}

	return orderedFromSnapshot;
}

export async function upsertShiftOrderSnapshot(params: {
	runner: SqlRunner;
	scheduleId: number;
	monthStart: string;
	orderedShiftIds: number[];
	actorOid: string;
}) {
	if (!params.monthStart.endsWith('-01')) {
		throw error(400, 'monthStart must be the first day of the month');
	}

	await createRequest(params.runner)
		.input('scheduleId', params.scheduleId)
		.input('monthStart', sql.Date, toSqlDateValue(params.monthStart))
		.input('actorOid', params.actorOid)
		.query(
			`IF NOT EXISTS (
				SELECT 1 FROM dbo.ShiftOrderMonths
				WHERE ScheduleId = @scheduleId AND EffectiveMonth = @monthStart
			)
			BEGIN
				INSERT INTO dbo.ShiftOrderMonths (ScheduleId, EffectiveMonth, CreatedBy)
				VALUES (@scheduleId, @monthStart, @actorOid);
			END
			ELSE
			BEGIN
				UPDATE dbo.ShiftOrderMonths
				SET UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @actorOid
				WHERE ScheduleId = @scheduleId AND EffectiveMonth = @monthStart;
			END;`
		);

	await createRequest(params.runner)
		.input('scheduleId', params.scheduleId)
		.input('monthStart', sql.Date, toSqlDateValue(params.monthStart))
		.query(
			`DELETE FROM dbo.ShiftOrderMonthItems
			 WHERE ScheduleId = @scheduleId
			   AND EffectiveMonth = @monthStart;`
		);

	for (let index = 0; index < params.orderedShiftIds.length; index += 1) {
		const employeeTypeId = params.orderedShiftIds[index];
		await createRequest(params.runner)
			.input('scheduleId', params.scheduleId)
			.input('monthStart', sql.Date, toSqlDateValue(params.monthStart))
			.input('employeeTypeId', employeeTypeId)
			.input('displayOrder', index + 1)
			.input('actorOid', params.actorOid)
			.query(
				`INSERT INTO dbo.ShiftOrderMonthItems (
					ScheduleId,
					EffectiveMonth,
					EmployeeTypeId,
					DisplayOrder,
					CreatedBy
				)
				VALUES (
					@scheduleId,
					@monthStart,
					@employeeTypeId,
					@displayOrder,
					@actorOid
				);`
			);
	}
}
