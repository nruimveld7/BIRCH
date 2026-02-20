import { error, json } from '@sveltejs/kit';
import type { Cookies, RequestHandler } from '@sveltejs/kit';
import sql from 'mssql';
import { GetPool } from '$lib/server/db';
import { getActiveScheduleId } from '$lib/server/auth';
import {
	cleanMonthValue,
	getActiveShiftIdsForMonth,
	monthEndForMonthStart,
	monthStartForDate,
	resolveShiftOrderForMonth,
	upsertShiftOrderSnapshot
} from '$lib/server/shift-order';

type ScheduleRole = 'Member' | 'Maintainer' | 'Manager';

type VersionRow = {
	StartDate: Date | string;
	EndDate: Date | string | null;
	Name: string;
	PatternId: number | null;
	DisplayOrder: number | null;
};

type ShiftRow = {
	EmployeeTypeId: number;
	Name: string;
	PatternId: number | null;
	PatternName: string | null;
	StartDate: Date | string;
	EndDate: Date | string | null;
};

type RemoveShiftPayload = {
	employeeTypeId?: unknown;
	editMode?: unknown;
	changeStartDate?: unknown;
	confirmUsedShiftRemoval?: unknown;
};

const CASE_SENSITIVE_COLLATION = 'Latin1_General_100_CS_AS';

function req(runner: sql.ConnectionPool | sql.Transaction): sql.Request {
	// mssql types do not accept a union argument, but both pool and transaction are valid at runtime.
	return new sql.Request(runner as sql.Transaction);
}

function cleanRequiredText(value: unknown, maxLength: number, label: string): string {
	if (typeof value !== 'string') {
		throw error(400, `${label} is required`);
	}
	const trimmed = value.trim();
	if (!trimmed) {
		throw error(400, `${label} is required`);
	}
	return trimmed.slice(0, maxLength);
}

function cleanOptionalPatternId(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw error(400, 'Pattern is invalid');
	}
	return parsed;
}

function cleanDateOnly(value: unknown, label: string): string {
	if (typeof value !== 'string') {
		throw error(400, `${label} is required`);
	}
	const trimmed = value.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		throw error(400, `${label} must be in YYYY-MM-DD format`);
	}
	const [yearText, monthText, dayText] = trimmed.split('-');
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	if (
		Number.isNaN(parsed.getTime()) ||
		parsed.getUTCFullYear() !== year ||
		parsed.getUTCMonth() + 1 !== month ||
		parsed.getUTCDate() !== day
	) {
		throw error(400, `${label} is invalid`);
	}
	return trimmed;
}

function cleanOptionalDateOnly(value: unknown, label: string): string | null {
	if (value === null || value === undefined || value === '') return null;
	return cleanDateOnly(value, label);
}

function cleanBoolean(value: unknown): boolean {
	return value === true;
}

function cleanEmployeeTypeId(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw error(400, 'Shift ID is required');
	}
	return parsed;
}

function cleanEmployeeTypeIdList(value: unknown): number[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw error(400, 'orderedEmployeeTypeIds is required');
	}
	const parsed = value.map((entry) => Number(entry));
	if (parsed.some((entry) => !Number.isInteger(entry) || entry <= 0)) {
		throw error(400, 'orderedEmployeeTypeIds must contain valid shift IDs');
	}
	if (new Set(parsed).size !== parsed.length) {
		throw error(400, 'orderedEmployeeTypeIds contains duplicates');
	}
	return parsed;
}

function toDateOnly(value: Date | string | null | undefined): string | null {
	if (!value) return null;
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if (typeof value === 'string') return value.slice(0, 10);
	return null;
}

function toSqlDateValue(dateOnly: string): Date {
	const [yearText, monthText, dayText] = dateOnly.split('-');
	return new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
}

function toNullableSqlDateValue(dateOnly: string | null): Date | null {
	return dateOnly ? toSqlDateValue(dateOnly) : null;
}

function plusOneDay(dateOnly: string): string {
	const parsed = new Date(`${dateOnly}T00:00:00Z`);
	return new Date(parsed.getTime() + 86_400_000).toISOString().slice(0, 10);
}

function minusOneDay(dateOnly: string): string {
	const parsed = new Date(`${dateOnly}T00:00:00Z`);
	return new Date(parsed.getTime() - 86_400_000).toISOString().slice(0, 10);
}

function dateLessThan(left: string, right: string): boolean {
	return left < right;
}

function dateGreaterThan(left: string, right: string): boolean {
	return left > right;
}

function normalizeEndDate(endDate: string | null): string {
	return endDate ?? '9999-12-31';
}

function rangesOverlap(
	leftStart: string,
	leftEnd: string | null,
	rightStart: string,
	rightEnd: string | null
): boolean {
	return leftStart <= normalizeEndDate(rightEnd) && rightStart <= normalizeEndDate(leftEnd);
}

async function getActorContext(localsUserOid: string, cookies: Cookies) {
	const scheduleId = await getActiveScheduleId(cookies);
	if (!scheduleId) {
		throw error(400, 'No active schedule selected');
	}

	const pool = await GetPool();
	const accessResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('userOid', localsUserOid)
		.query(
			`SELECT TOP (1) r.RoleName
			 FROM dbo.ScheduleUsers su
			 INNER JOIN dbo.Roles r
			   ON r.RoleId = su.RoleId
			 WHERE su.ScheduleId = @scheduleId
			   AND su.UserOid = @userOid
			   AND su.IsActive = 1
			   AND su.DeletedAt IS NULL
			 ORDER BY
			   CASE r.RoleName
				 WHEN 'Manager' THEN 3
				 WHEN 'Maintainer' THEN 2
				 WHEN 'Member' THEN 1
				 ELSE 0
			   END DESC;`
		);

	const role = accessResult.recordset?.[0]?.RoleName as ScheduleRole | undefined;
	if (role !== 'Manager' && role !== 'Maintainer') {
		throw error(403, 'Insufficient permissions');
	}

	return { pool, scheduleId, actorOid: localsUserOid };
}

async function ensurePatternExists(
	runner: sql.ConnectionPool | sql.Transaction,
	scheduleId: number,
	patternId: number | null
) {
	if (patternId === null) return;
	const patternResult = await req(runner)
		.input('scheduleId', scheduleId)
		.input('patternId', patternId)
		.query(
			`SELECT TOP (1) PatternId
			 FROM dbo.Patterns
			 WHERE ScheduleId = @scheduleId
			   AND PatternId = @patternId
			   AND IsActive = 1
			   AND DeletedAt IS NULL;`
		);
	if (!patternResult.recordset?.[0]?.PatternId) {
		throw error(400, 'Selected pattern does not exist');
	}
}

async function ensureShiftExists(
	runner: sql.ConnectionPool | sql.Transaction,
	scheduleId: number,
	employeeTypeId: number
) {
	const result = await req(runner)
		.input('scheduleId', scheduleId)
		.input('employeeTypeId', employeeTypeId)
		.query(
			`SELECT TOP (1) EmployeeTypeId
			 FROM dbo.EmployeeTypes
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @employeeTypeId
			   AND IsActive = 1
			   AND DeletedAt IS NULL;`
		);
	if (!result.recordset?.[0]?.EmployeeTypeId) {
		throw error(404, 'Shift not found');
	}
}

async function assertNoNameOverlap(params: {
	runner: sql.ConnectionPool | sql.Transaction;
	scheduleId: number;
	name: string;
	startDate: string;
	endDate: string | null;
	excludeEmployeeTypeId?: number | null;
}) {
	const overlap = await req(params.runner)
		.input('scheduleId', params.scheduleId)
		.input('name', params.name)
		.input('startDate', sql.Date, toSqlDateValue(params.startDate))
		.input('endDate', sql.Date, toNullableSqlDateValue(params.endDate))
		.input('excludeEmployeeTypeId', params.excludeEmployeeTypeId ?? null)
		.query(
			`SELECT TOP (1) etv.EmployeeTypeId
			 FROM dbo.EmployeeTypeVersions etv
			 INNER JOIN dbo.EmployeeTypes et
			   ON et.EmployeeTypeId = etv.EmployeeTypeId
			  AND et.ScheduleId = etv.ScheduleId
			  AND et.IsActive = 1
			  AND et.DeletedAt IS NULL
			 WHERE etv.ScheduleId = @scheduleId
			   AND etv.IsActive = 1
			   AND etv.DeletedAt IS NULL
			   AND etv.Name COLLATE ${CASE_SENSITIVE_COLLATION} = @name COLLATE ${CASE_SENSITIVE_COLLATION}
			   AND etv.StartDate <= ISNULL(@endDate, '9999-12-31')
			   AND ISNULL(etv.EndDate, '9999-12-31') >= @startDate
			   AND (@excludeEmployeeTypeId IS NULL OR etv.EmployeeTypeId <> @excludeEmployeeTypeId);`
		);

	if (overlap.recordset?.[0]?.EmployeeTypeId) {
		throw error(409, 'A shift with this name is already active during the selected timespan');
	}
}

async function loadVersions(
	runner: sql.ConnectionPool | sql.Transaction,
	scheduleId: number,
	employeeTypeId: number
): Promise<Array<{ startDate: string; endDate: string | null; name: string; patternId: number | null }>> {
	const result = await req(runner)
		.input('scheduleId', scheduleId)
		.input('employeeTypeId', employeeTypeId)
		.query(
			`SELECT StartDate, EndDate, Name, PatternId
			 FROM dbo.EmployeeTypeVersions
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @employeeTypeId
			   AND IsActive = 1
			   AND DeletedAt IS NULL
			 ORDER BY StartDate ASC;`
		);
	return (result.recordset as VersionRow[]).map((row) => ({
		startDate: toDateOnly(row.StartDate) ?? '',
		endDate: toDateOnly(row.EndDate),
		name: row.Name,
		patternId: row.PatternId === null ? null : Number(row.PatternId)
	}));
}

async function replaceVersions(params: {
	runner: sql.ConnectionPool | sql.Transaction;
	scheduleId: number;
	employeeTypeId: number;
	versions: Array<{ startDate: string; endDate: string | null; name: string; patternId: number | null }>;
	actorOid: string;
}) {
	await req(params.runner)
		.input('scheduleId', params.scheduleId)
		.input('employeeTypeId', params.employeeTypeId)
		.query(
			`DELETE FROM dbo.EmployeeTypeVersions
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @employeeTypeId;`
		);

	for (const version of params.versions) {
		await req(params.runner)
			.input('scheduleId', params.scheduleId)
			.input('employeeTypeId', params.employeeTypeId)
			.input('startDate', sql.Date, toSqlDateValue(version.startDate))
			.input('endDate', sql.Date, toNullableSqlDateValue(version.endDate))
			.input('name', version.name)
			.input('patternId', version.patternId)
			.input('actorOid', params.actorOid)
			.query(
				`INSERT INTO dbo.EmployeeTypeVersions (
					ScheduleId,
					EmployeeTypeId,
					StartDate,
					EndDate,
					Name,
					PatternId,
					CreatedBy,
					IsActive
				)
				VALUES (
					@scheduleId,
					@employeeTypeId,
					@startDate,
					@endDate,
					@name,
					@patternId,
					@actorOid,
					1
				);`
			);
	}
}

async function syncShiftMainFromVersions(params: {
	runner: sql.ConnectionPool | sql.Transaction;
	scheduleId: number;
	employeeTypeId: number;
	actorOid: string;
}) {
	const rows = await loadVersions(params.runner, params.scheduleId, params.employeeTypeId);
	if (rows.length === 0) {
		await req(params.runner)
			.input('scheduleId', params.scheduleId)
			.input('employeeTypeId', params.employeeTypeId)
			.input('actorOid', params.actorOid)
			.query(
				`UPDATE dbo.EmployeeTypes
				 SET IsActive = 0,
					 DeletedAt = SYSUTCDATETIME(),
					 DeletedBy = @actorOid,
					 UpdatedAt = SYSUTCDATETIME(),
					 UpdatedBy = @actorOid
				 WHERE ScheduleId = @scheduleId
				   AND EmployeeTypeId = @employeeTypeId;`
			);
		return;
	}

	const earliest = rows[0];
	const latest = rows[rows.length - 1];
	const hasOpenEnded = rows.some((row) => row.endDate === null);
	const latestClosedEnd = rows.reduce<string | null>((current, row) => {
		if (row.endDate === null) return current;
		if (!current || row.endDate > current) return row.endDate;
		return current;
	}, null);

	await req(params.runner)
		.input('scheduleId', params.scheduleId)
		.input('employeeTypeId', params.employeeTypeId)
		.input('name', latest.name)
		.input('patternId', latest.patternId)
		.input('startDate', sql.Date, toSqlDateValue(earliest.startDate))
		.input('endDate', sql.Date, toNullableSqlDateValue(hasOpenEnded ? null : latestClosedEnd))
		.input('actorOid', params.actorOid)
		.query(
			`UPDATE dbo.EmployeeTypes
			 SET Name = @name,
				 PatternId = @patternId,
				 StartDate = @startDate,
				 EndDate = @endDate,
				 IsActive = 1,
				 DeletedAt = NULL,
				 DeletedBy = NULL,
				 UpdatedAt = SYSUTCDATETIME(),
				 UpdatedBy = @actorOid
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @employeeTypeId;`
		);
}

function applyIntervalSurgery(params: {
	existing: Array<{ startDate: string; endDate: string | null; name: string; patternId: number | null }>;
	inserted: { startDate: string; endDate: string | null; name: string; patternId: number | null };
}): Array<{ startDate: string; endDate: string | null; name: string; patternId: number | null }> {
	const next: Array<{ startDate: string; endDate: string | null; name: string; patternId: number | null }> = [];

	for (const row of params.existing) {
		if (!rangesOverlap(row.startDate, row.endDate, params.inserted.startDate, params.inserted.endDate)) {
			next.push(row);
			continue;
		}

		if (dateLessThan(row.startDate, params.inserted.startDate)) {
			const leftEnd = minusOneDay(params.inserted.startDate);
			if (!row.endDate || !dateLessThan(row.endDate, row.startDate)) {
				if (leftEnd >= row.startDate) {
					next.push({ ...row, endDate: row.endDate && row.endDate < leftEnd ? row.endDate : leftEnd });
				}
			}
		}

		if (params.inserted.endDate && (!row.endDate || dateGreaterThan(row.endDate, params.inserted.endDate))) {
			const rightStart = plusOneDay(params.inserted.endDate);
			if (!row.endDate || rightStart <= row.endDate) {
				next.push({ ...row, startDate: rightStart });
			}
		}
	}

	next.push(params.inserted);
	next.sort((a, b) => a.startDate.localeCompare(b.startDate));
	return next;
}

async function cleanupShiftScopedDataAfterEndDate(params: {
	runner: sql.ConnectionPool | sql.Transaction;
	scheduleId: number;
	employeeTypeId: number;
	endDate: string;
	actorOid: string;
}) {
	await req(params.runner)
		.input('scheduleId', params.scheduleId)
		.input('employeeTypeId', params.employeeTypeId)
		.input('endDate', sql.Date, toSqlDateValue(params.endDate))
		.input('actorOid', params.actorOid)
		.query(
			`DELETE FROM dbo.ScheduleUserTypes
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @employeeTypeId
			   AND IsActive = 1
			   AND DeletedAt IS NULL
			   AND StartDate > @endDate;

			 UPDATE dbo.ScheduleUserTypes
			 SET EndDate = @endDate,
				 EndedAt = SYSUTCDATETIME(),
				 EndedBy = @actorOid
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @employeeTypeId
			   AND IsActive = 1
			   AND DeletedAt IS NULL
			   AND StartDate <= @endDate
			   AND (EndDate IS NULL OR EndDate > @endDate);

			 DELETE FROM dbo.ScheduleEvents
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @employeeTypeId
			   AND IsActive = 1
			   AND DeletedAt IS NULL
			   AND StartDate > @endDate;

			 UPDATE dbo.ScheduleEvents
			 SET EndDate = @endDate
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @employeeTypeId
			   AND IsActive = 1
			   AND DeletedAt IS NULL
			   AND StartDate <= @endDate
			   AND EndDate > @endDate;

			 DELETE FROM dbo.EmployeeTypeVersions
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @employeeTypeId
			   AND IsActive = 1
			   AND DeletedAt IS NULL
			   AND StartDate > @endDate;

			 UPDATE dbo.EmployeeTypeVersions
			 SET EndDate = @endDate,
				 UpdatedAt = SYSUTCDATETIME(),
				 UpdatedBy = @actorOid
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @employeeTypeId
			   AND IsActive = 1
			   AND DeletedAt IS NULL
			   AND StartDate <= @endDate
			   AND (EndDate IS NULL OR EndDate > @endDate);`
		);
}

async function getFallbackOrderedShiftIdsForMonth(params: {
	runner: sql.ConnectionPool | sql.Transaction;
	scheduleId: number;
	monthStart: string;
}): Promise<number[]> {
	const monthEnd = monthEndForMonthStart(params.monthStart);
	const result = await req(params.runner)
		.input('scheduleId', params.scheduleId)
		.input('monthStart', params.monthStart)
		.input('monthEnd', monthEnd)
		.query(
			`SELECT DISTINCT et.EmployeeTypeId, et.DisplayOrder, et.Name
			 FROM dbo.EmployeeTypes et
			 INNER JOIN dbo.EmployeeTypeVersions etv
			   ON etv.EmployeeTypeId = et.EmployeeTypeId
			  AND etv.ScheduleId = et.ScheduleId
			  AND etv.IsActive = 1
			  AND etv.DeletedAt IS NULL
			  AND etv.StartDate <= @monthEnd
			  AND (etv.EndDate IS NULL OR etv.EndDate >= @monthStart)
			 WHERE et.ScheduleId = @scheduleId
			   AND et.IsActive = 1
			   AND et.DeletedAt IS NULL
			 ORDER BY et.DisplayOrder ASC, et.Name ASC, et.EmployeeTypeId ASC;`
		);
	return (result.recordset as Array<{ EmployeeTypeId: number }>).map((row) => Number(row.EmployeeTypeId));
}

async function registerAppendShiftOrderForMonth(params: {
	runner: sql.ConnectionPool | sql.Transaction;
	scheduleId: number;
	monthStart: string;
	employeeTypeId: number;
	actorOid: string;
}) {
	const activeShiftIds = await getActiveShiftIdsForMonth({
		runner: params.runner,
		scheduleId: params.scheduleId,
		monthStart: params.monthStart
	});
	if (!activeShiftIds.includes(params.employeeTypeId)) {
		return;
	}

	const fallbackOrderedIds = await getFallbackOrderedShiftIdsForMonth({
		runner: params.runner,
		scheduleId: params.scheduleId,
		monthStart: params.monthStart
	});
	const resolved = await resolveShiftOrderForMonth({
		runner: params.runner,
		scheduleId: params.scheduleId,
		monthStart: params.monthStart,
		activeShiftIds,
		fallbackOrderedIds
	});
	const next = resolved.filter((id) => id !== params.employeeTypeId);
	next.push(params.employeeTypeId);
	await upsertShiftOrderSnapshot({
		runner: params.runner,
		scheduleId: params.scheduleId,
		monthStart: params.monthStart,
		orderedShiftIds: next,
		actorOid: params.actorOid
	});
}

async function registerRemoveShiftOrderForMonth(params: {
	runner: sql.ConnectionPool | sql.Transaction;
	scheduleId: number;
	monthStart: string;
	employeeTypeId: number;
	actorOid: string;
}) {
	const activeShiftIds = await getActiveShiftIdsForMonth({
		runner: params.runner,
		scheduleId: params.scheduleId,
		monthStart: params.monthStart
	});
	const fallbackOrderedIds = await getFallbackOrderedShiftIdsForMonth({
		runner: params.runner,
		scheduleId: params.scheduleId,
		monthStart: params.monthStart
	});
	const resolved = await resolveShiftOrderForMonth({
		runner: params.runner,
		scheduleId: params.scheduleId,
		monthStart: params.monthStart,
		activeShiftIds,
		fallbackOrderedIds
	});
	const next = resolved.filter((id) => id !== params.employeeTypeId);
	await upsertShiftOrderSnapshot({
		runner: params.runner,
		scheduleId: params.scheduleId,
		monthStart: params.monthStart,
		orderedShiftIds: next,
		actorOid: params.actorOid
	});
}

async function createOrReinstateShift(params: {
	tx: sql.Transaction;
	scheduleId: number;
	name: string;
	patternId: number | null;
	startDate: string;
	endDate: string | null;
	actorOid: string;
}): Promise<number> {
	await assertNoNameOverlap({
		runner: params.tx,
		scheduleId: params.scheduleId,
		name: params.name,
		startDate: params.startDate,
		endDate: params.endDate
	});

	const softDeleted = await req(params.tx)
		.input('scheduleId', params.scheduleId)
		.input('name', params.name)
		.query(
			`SELECT TOP (1) EmployeeTypeId
			 FROM dbo.EmployeeTypes
			 WHERE ScheduleId = @scheduleId
			   AND Name COLLATE ${CASE_SENSITIVE_COLLATION} = @name COLLATE ${CASE_SENSITIVE_COLLATION}
			   AND (IsActive = 0 OR DeletedAt IS NOT NULL)
			 ORDER BY DeletedAt DESC, EmployeeTypeId DESC;`
		);

	let employeeTypeId = Number(softDeleted.recordset?.[0]?.EmployeeTypeId ?? 0);
	if (employeeTypeId > 0) {
		await req(params.tx)
			.input('scheduleId', params.scheduleId)
			.input('employeeTypeId', employeeTypeId)
			.input('name', params.name)
			.input('patternId', params.patternId)
			.input('startDate', sql.Date, toSqlDateValue(params.startDate))
			.input('endDate', sql.Date, toNullableSqlDateValue(params.endDate))
			.input('actorOid', params.actorOid)
			.query(
				`UPDATE dbo.EmployeeTypes
				 SET Name = @name,
					 PatternId = @patternId,
					 StartDate = @startDate,
					 EndDate = @endDate,
					 IsActive = 1,
					 DeletedAt = NULL,
					 DeletedBy = NULL,
					 UpdatedAt = SYSUTCDATETIME(),
					 UpdatedBy = @actorOid
				 WHERE ScheduleId = @scheduleId
				   AND EmployeeTypeId = @employeeTypeId;`
			);

		await req(params.tx)
			.input('scheduleId', params.scheduleId)
			.input('employeeTypeId', employeeTypeId)
			.query(
				`DELETE FROM dbo.EmployeeTypeVersions
				 WHERE ScheduleId = @scheduleId
				   AND EmployeeTypeId = @employeeTypeId;`
			);
	} else {
		const inserted = await req(params.tx)
			.input('scheduleId', params.scheduleId)
			.input('name', params.name)
			.input('patternId', params.patternId)
			.input('startDate', sql.Date, toSqlDateValue(params.startDate))
			.input('endDate', sql.Date, toNullableSqlDateValue(params.endDate))
			.input('actorOid', params.actorOid)
			.query(
				`INSERT INTO dbo.EmployeeTypes (
					ScheduleId,
					Name,
					PatternId,
					StartDate,
					EndDate,
					DisplayOrder,
					CreatedBy
				)
				OUTPUT inserted.EmployeeTypeId AS EmployeeTypeId
				VALUES (
					@scheduleId,
					@name,
					@patternId,
					@startDate,
					@endDate,
					1,
					@actorOid
				);`
			);
		employeeTypeId = Number(inserted.recordset?.[0]?.EmployeeTypeId ?? 0);
	}

	if (!employeeTypeId) {
		throw error(500, 'Failed to create shift');
	}

	await replaceVersions({
		runner: params.tx,
		scheduleId: params.scheduleId,
		employeeTypeId,
		actorOid: params.actorOid,
		versions: [
			{
				startDate: params.startDate,
				endDate: params.endDate,
				name: params.name,
				patternId: params.patternId
			}
		]
	});

	await syncShiftMainFromVersions({
		runner: params.tx,
		scheduleId: params.scheduleId,
		employeeTypeId,
		actorOid: params.actorOid
	});

	return employeeTypeId;
}

async function moveShiftScopedDataFromDate(params: {
	tx: sql.Transaction;
	scheduleId: number;
	fromEmployeeTypeId: number;
	toEmployeeTypeId: number;
	effectiveStartDate: string;
	actorOid: string;
}) {
	const splitDateEnd = minusOneDay(params.effectiveStartDate);

	await req(params.tx)
		.input('scheduleId', params.scheduleId)
		.input('fromEmployeeTypeId', params.fromEmployeeTypeId)
		.input('toEmployeeTypeId', params.toEmployeeTypeId)
		.input('effectiveStartDate', sql.Date, toSqlDateValue(params.effectiveStartDate))
		.input('splitDateEnd', sql.Date, toSqlDateValue(splitDateEnd))
		.input('actorOid', params.actorOid)
		.query(
			`UPDATE dbo.ScheduleUserTypes
			 SET EmployeeTypeId = @toEmployeeTypeId
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @fromEmployeeTypeId
			   AND StartDate >= @effectiveStartDate
			   AND IsActive = 1
			   AND DeletedAt IS NULL;

			 DECLARE @AssignmentSplits TABLE (
				UserOid nvarchar(64) NOT NULL,
				EndDate date NULL,
				DisplayOrder int NOT NULL
			 );

			 INSERT INTO @AssignmentSplits (UserOid, EndDate, DisplayOrder)
			 SELECT sut.UserOid, sut.EndDate, sut.DisplayOrder
			 FROM dbo.ScheduleUserTypes sut
			 WHERE sut.ScheduleId = @scheduleId
			   AND sut.EmployeeTypeId = @fromEmployeeTypeId
			   AND sut.StartDate < @effectiveStartDate
			   AND (sut.EndDate IS NULL OR sut.EndDate >= @effectiveStartDate)
			   AND sut.IsActive = 1
			   AND sut.DeletedAt IS NULL;

			 UPDATE dbo.ScheduleUserTypes
			 SET EndDate = @splitDateEnd,
				 EndedAt = SYSUTCDATETIME(),
				 EndedBy = @actorOid
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @fromEmployeeTypeId
			   AND StartDate < @effectiveStartDate
			   AND (EndDate IS NULL OR EndDate >= @effectiveStartDate)
			   AND IsActive = 1
			   AND DeletedAt IS NULL;

			 INSERT INTO dbo.ScheduleUserTypes (
				ScheduleId,
				UserOid,
				EmployeeTypeId,
				StartDate,
				EndDate,
				DisplayOrder,
				CreatedBy,
				IsActive
			 )
			 SELECT
				@scheduleId,
				split.UserOid,
				@toEmployeeTypeId,
				@effectiveStartDate,
				split.EndDate,
				split.DisplayOrder,
				@actorOid,
				1
			 FROM @AssignmentSplits split;

			 UPDATE dbo.ScheduleEvents
			 SET EmployeeTypeId = @toEmployeeTypeId
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @fromEmployeeTypeId
			   AND StartDate >= @effectiveStartDate
			   AND IsActive = 1
			   AND DeletedAt IS NULL;

			 DECLARE @EventSplits TABLE (
				UserOid nvarchar(64) NULL,
				EndDate date NOT NULL,
				CoverageCodeId int NULL,
				CustomCode nvarchar(16) NULL,
				CustomName nvarchar(100) NULL,
				CustomDisplayMode nvarchar(30) NULL,
				CustomColor nvarchar(20) NULL,
				Title nvarchar(200) NULL,
				Notes nvarchar(max) NULL,
				CreatedBy nvarchar(64) NULL
			 );

			 INSERT INTO @EventSplits (
				UserOid,
				EndDate,
				CoverageCodeId,
				CustomCode,
				CustomName,
				CustomDisplayMode,
				CustomColor,
				Title,
				Notes,
				CreatedBy
			 )
			 SELECT
				se.UserOid,
				se.EndDate,
				se.CoverageCodeId,
				se.CustomCode,
				se.CustomName,
				se.CustomDisplayMode,
				se.CustomColor,
				se.Title,
				se.Notes,
				se.CreatedBy
			 FROM dbo.ScheduleEvents se
			 WHERE se.ScheduleId = @scheduleId
			   AND se.EmployeeTypeId = @fromEmployeeTypeId
			   AND se.StartDate < @effectiveStartDate
			   AND se.EndDate >= @effectiveStartDate
			   AND se.IsActive = 1
			   AND se.DeletedAt IS NULL;

			 UPDATE dbo.ScheduleEvents
			 SET EndDate = @splitDateEnd
			 WHERE ScheduleId = @scheduleId
			   AND EmployeeTypeId = @fromEmployeeTypeId
			   AND StartDate < @effectiveStartDate
			   AND EndDate >= @effectiveStartDate
			   AND IsActive = 1
			   AND DeletedAt IS NULL;

			 INSERT INTO dbo.ScheduleEvents (
				ScheduleId,
				UserOid,
				EmployeeTypeId,
				StartDate,
				EndDate,
				CoverageCodeId,
				CustomCode,
				CustomName,
				CustomDisplayMode,
				CustomColor,
				Title,
				Notes,
				CreatedBy,
				IsActive
			 )
			 SELECT
				@scheduleId,
				eventSplit.UserOid,
				@toEmployeeTypeId,
				@effectiveStartDate,
				eventSplit.EndDate,
				eventSplit.CoverageCodeId,
				eventSplit.CustomCode,
				eventSplit.CustomName,
				eventSplit.CustomDisplayMode,
				eventSplit.CustomColor,
				eventSplit.Title,
				eventSplit.Notes,
				COALESCE(eventSplit.CreatedBy, @actorOid),
				1
			 FROM @EventSplits eventSplit;`
		);
}

export const GET: RequestHandler = async ({ locals, cookies, url }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, scheduleId } = await getActorContext(currentUser.id, cookies);
	const month = url.searchParams.get('month')?.trim();
	const monthStart = month ? cleanMonthValue(month, 'month') : `${new Date().toISOString().slice(0, 7)}-01`;
	const monthEnd = monthEndForMonthStart(monthStart);

	const shiftResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('monthStart', sql.Date, toSqlDateValue(monthStart))
		.input('monthEnd', sql.Date, toSqlDateValue(monthEnd))
		.query(
			`SELECT
				et.EmployeeTypeId,
				COALESCE(vAtMonthStart.Name, vInMonth.Name) AS Name,
				COALESCE(vAtMonthStart.PatternId, vInMonth.PatternId) AS PatternId,
				p.Name AS PatternName,
				COALESCE(vAtMonthStart.StartDate, vInMonth.StartDate) AS StartDate,
				COALESCE(vAtMonthStart.EndDate, vInMonth.EndDate) AS EndDate
			 FROM dbo.EmployeeTypes et
			 OUTER APPLY (
				SELECT TOP (1) etv.Name, etv.PatternId, etv.StartDate, etv.EndDate
				FROM dbo.EmployeeTypeVersions etv
				WHERE etv.ScheduleId = et.ScheduleId
				  AND etv.EmployeeTypeId = et.EmployeeTypeId
				  AND etv.IsActive = 1
				  AND etv.DeletedAt IS NULL
				  AND (etv.EndDate IS NULL OR etv.EndDate >= @monthStart)
				  AND etv.StartDate <= @monthStart
				ORDER BY etv.StartDate DESC
			 ) vAtMonthStart
			 OUTER APPLY (
				SELECT TOP (1) etv.Name, etv.PatternId, etv.StartDate, etv.EndDate
				FROM dbo.EmployeeTypeVersions etv
				WHERE etv.ScheduleId = et.ScheduleId
				  AND etv.EmployeeTypeId = et.EmployeeTypeId
				  AND etv.IsActive = 1
				  AND etv.DeletedAt IS NULL
				  AND etv.StartDate > @monthStart
				  AND etv.StartDate <= @monthEnd
				  AND (etv.EndDate IS NULL OR etv.EndDate >= @monthStart)
				ORDER BY etv.StartDate ASC
			 ) vInMonth
			 LEFT JOIN dbo.Patterns p
				ON p.PatternId = COALESCE(vAtMonthStart.PatternId, vInMonth.PatternId)
			   AND p.ScheduleId = et.ScheduleId
			   AND p.IsActive = 1
			   AND p.DeletedAt IS NULL
			 WHERE et.ScheduleId = @scheduleId
			   AND et.IsActive = 1
			   AND et.DeletedAt IS NULL
			   AND COALESCE(vAtMonthStart.StartDate, vInMonth.StartDate) IS NOT NULL;`
		);

	const historyResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.query(
			`SELECT
				etv.EmployeeTypeId,
				etv.StartDate,
				etv.EndDate,
				etv.Name,
				etv.PatternId,
				p.Name AS PatternName
			 FROM dbo.EmployeeTypeVersions etv
			 LEFT JOIN dbo.Patterns p
				ON p.PatternId = etv.PatternId
			   AND p.ScheduleId = etv.ScheduleId
			   AND p.IsActive = 1
			   AND p.DeletedAt IS NULL
			 WHERE etv.ScheduleId = @scheduleId
			   AND etv.IsActive = 1
			   AND etv.DeletedAt IS NULL
			 ORDER BY etv.EmployeeTypeId ASC, etv.StartDate ASC;`
		);

	const activeShiftIds = (shiftResult.recordset as ShiftRow[]).map((row) => Number(row.EmployeeTypeId));
	const fallbackOrderedIds = await getFallbackOrderedShiftIdsForMonth({
		runner: pool,
		scheduleId,
		monthStart
	});
	const orderedShiftIds = await resolveShiftOrderForMonth({
		runner: pool,
		scheduleId,
		monthStart,
		activeShiftIds,
		fallbackOrderedIds
	});
	const orderMap = new Map(orderedShiftIds.map((id, index) => [id, index + 1]));

	const historyByShift = new Map<
		number,
		Array<{
			sortOrder: number;
			startDate: string;
			endDate: string | null;
			name: string;
			patternId: number | null;
			pattern: string;
		}>
	>();

	for (const row of historyResult.recordset as Array<VersionRow & { EmployeeTypeId: number; PatternName: string | null }>) {
		const employeeTypeId = Number(row.EmployeeTypeId);
		const list = historyByShift.get(employeeTypeId) ?? [];
		list.push({
			sortOrder: orderMap.get(employeeTypeId) ?? Number.MAX_SAFE_INTEGER,
			startDate: toDateOnly(row.StartDate) ?? '',
			endDate: toDateOnly(row.EndDate),
			name: row.Name,
			patternId: row.PatternId,
			pattern: row.PatternName?.trim() || ''
		});
		historyByShift.set(employeeTypeId, list);
	}

	const shifts = (shiftResult.recordset as ShiftRow[])
		.map((row) => {
			const employeeTypeId = Number(row.EmployeeTypeId);
			return {
				employeeTypeId,
				sortOrder: orderMap.get(employeeTypeId) ?? Number.MAX_SAFE_INTEGER,
				name: row.Name,
				patternId: row.PatternId,
				pattern: row.PatternName?.trim() || '',
				startDate: toDateOnly(row.StartDate) ?? '',
				endDate: toDateOnly(row.EndDate),
				changes: historyByShift.get(employeeTypeId) ?? []
			};
		})
		.sort((a, b) => {
			if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
			const nameDiff = a.name.localeCompare(b.name);
			if (nameDiff !== 0) return nameDiff;
			return a.employeeTypeId - b.employeeTypeId;
		});

	return json({ shifts });
};

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, scheduleId, actorOid } = await getActorContext(currentUser.id, cookies);
	const body = await request.json().catch(() => null);

	const name = cleanRequiredText(body?.name, 50, 'Shift name');
	const patternId = cleanOptionalPatternId(body?.patternId);
	const startDate = cleanDateOnly(body?.startDate, 'Start date');
	const endDate = cleanOptionalDateOnly(body?.endDate, 'End date');
	if (endDate && endDate < startDate) {
		throw error(400, 'End date must be on or after start date');
	}

	await ensurePatternExists(pool, scheduleId, patternId);

	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const employeeTypeId = await createOrReinstateShift({
			tx,
			scheduleId,
			name,
			patternId,
			startDate,
			endDate,
			actorOid
		});

		await registerAppendShiftOrderForMonth({
			runner: tx,
			scheduleId,
			monthStart: monthStartForDate(startDate),
			employeeTypeId,
			actorOid
		});

		await tx.commit();
	} catch (err) {
		try {
			await tx.rollback();
		} catch {
			// keep original error
		}
		throw err;
	}

	return json({ success: true }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ locals, cookies, request }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, scheduleId, actorOid } = await getActorContext(currentUser.id, cookies);
	const body = await request.json().catch(() => null);
	const employeeTypeId = cleanEmployeeTypeId(body?.employeeTypeId);
	const reorderOnly = body?.reorderOnly === true;

	if (reorderOnly) {
		const startDate = cleanDateOnly(body?.startDate, 'Start date');
		const monthStart = monthStartForDate(startDate);
		const orderedEmployeeTypeIds = cleanEmployeeTypeIdList(body?.orderedEmployeeTypeIds);

		const tx = new sql.Transaction(pool);
		await tx.begin();
		try {
			const activeShiftIds = await getActiveShiftIdsForMonth({
				runner: tx,
				scheduleId,
				monthStart
			});
			const activeSet = new Set(activeShiftIds);
			if (orderedEmployeeTypeIds.length !== activeShiftIds.length) {
				throw error(400, 'orderedEmployeeTypeIds must include all shifts active in the selected month');
			}
			if (!orderedEmployeeTypeIds.every((id) => activeSet.has(id))) {
				throw error(400, 'orderedEmployeeTypeIds includes invalid shifts for the selected month');
			}

			await upsertShiftOrderSnapshot({
				runner: tx,
				scheduleId,
				monthStart,
				orderedShiftIds: orderedEmployeeTypeIds,
				actorOid
			});
			await tx.commit();
		} catch (err) {
			try {
				await tx.rollback();
			} catch {
				// keep original error
			}
			throw err;
		}
		return json({ success: true });
	}

	const name = cleanRequiredText(body?.name, 50, 'Shift name');
	const patternId = cleanOptionalPatternId(body?.patternId);
	const startDate = cleanDateOnly(body?.startDate, 'Change effective date');
	const endDate = cleanOptionalDateOnly(body?.endDate, 'End date');
	if (endDate && endDate < startDate) {
		throw error(400, 'End date must be on or after change effective date');
	}

	const editMode =
		typeof body?.editMode === 'string' && body.editMode.trim().toLowerCase() === 'history'
			? 'history'
			: 'timeline';
	const changeStartDate =
		editMode === 'history' ? cleanDateOnly(body?.changeStartDate, 'Change start date') : null;

	await ensurePatternExists(pool, scheduleId, patternId);
	await ensureShiftExists(pool, scheduleId, employeeTypeId);

	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const versionsBefore = await loadVersions(tx, scheduleId, employeeTypeId);
		if (versionsBefore.length === 0) {
			throw error(400, 'Shift has no editable entries');
		}
		const oldPrimaryStart = versionsBefore[0]?.startDate ?? startDate;

		let sourceForName = versionsBefore.find((row) => row.startDate === (changeStartDate ?? startDate)) ?? null;
		if (!sourceForName) {
			sourceForName =
				versionsBefore.find((row) => rangesOverlap(row.startDate, row.endDate, startDate, startDate)) ??
				versionsBefore[versionsBefore.length - 1];
		}
		const oldName = sourceForName?.name ?? name;
		const rename = oldName !== name;

		if (rename) {
			await assertNoNameOverlap({
				runner: tx,
				scheduleId,
				name,
				startDate,
				endDate,
				excludeEmployeeTypeId: employeeTypeId
			});

			const newEmployeeTypeId = await createOrReinstateShift({
				tx,
				scheduleId,
				name,
				patternId,
				startDate,
				endDate,
				actorOid
			});

			// If the rename effective date is before the old primary start, the rename acts as
			// a full replacement. Do not carry old future versions into the new shift.
			const moveFutureVersions =
				startDate < oldPrimaryStart
					? []
					: versionsBefore.filter((row) => row.startDate > startDate).map((row) => ({ ...row }));
			const oldRemaining = versionsBefore
				.filter((row) => row.startDate < startDate)
				.map((row) => {
					if (!row.endDate || row.endDate >= startDate) {
						return { ...row, endDate: minusOneDay(startDate) };
					}
					return { ...row };
				})
				.filter((row) => row.endDate === null || row.endDate >= row.startDate);
			oldRemaining.sort((a, b) => a.startDate.localeCompare(b.startDate));

			if (moveFutureVersions.length > 0) {
				const targetVersions = await loadVersions(tx, scheduleId, newEmployeeTypeId);
				let merged = [...targetVersions];
				for (const moved of moveFutureVersions) {
					merged = applyIntervalSurgery({ existing: merged, inserted: moved });
				}
				await replaceVersions({
					runner: tx,
					scheduleId,
					employeeTypeId: newEmployeeTypeId,
					actorOid,
					versions: merged
				});
			}

			await replaceVersions({
				runner: tx,
				scheduleId,
				employeeTypeId,
				actorOid,
				versions: oldRemaining
			});

			await moveShiftScopedDataFromDate({
				tx,
				scheduleId,
				fromEmployeeTypeId: employeeTypeId,
				toEmployeeTypeId: newEmployeeTypeId,
				effectiveStartDate: startDate,
				actorOid
			});

			if (endDate) {
				await cleanupShiftScopedDataAfterEndDate({
					runner: tx,
					scheduleId,
					employeeTypeId: newEmployeeTypeId,
					endDate,
					actorOid
				});
			}

			await syncShiftMainFromVersions({
				runner: tx,
				scheduleId,
				employeeTypeId,
				actorOid
			});
			await syncShiftMainFromVersions({
				runner: tx,
				scheduleId,
				employeeTypeId: newEmployeeTypeId,
				actorOid
			});

			await registerAppendShiftOrderForMonth({
				runner: tx,
				scheduleId,
				monthStart: monthStartForDate(startDate),
				employeeTypeId: newEmployeeTypeId,
				actorOid
			});

			await tx.commit();
			return json({ success: true, mode: 'rename' });
		}

		await assertNoNameOverlap({
			runner: tx,
			scheduleId,
			name,
			startDate,
			endDate,
			excludeEmployeeTypeId: employeeTypeId
		});

		let working = [...versionsBefore];
		if (editMode === 'history' && changeStartDate) {
			const exists = working.some((entry) => entry.startDate === changeStartDate);
			if (!exists) {
				throw error(404, 'Shift change entry not found');
			}
			working = working.filter((entry) => entry.startDate !== changeStartDate);
		}

		const rebuilt = applyIntervalSurgery({
			existing: working,
			inserted: {
				startDate,
				endDate,
				name,
				patternId
			}
		});

		await replaceVersions({
			runner: tx,
			scheduleId,
			employeeTypeId,
			actorOid,
			versions: rebuilt
		});

		if (endDate) {
			await cleanupShiftScopedDataAfterEndDate({
				runner: tx,
				scheduleId,
				employeeTypeId,
				endDate,
				actorOid
			});
		}

		await syncShiftMainFromVersions({
			runner: tx,
			scheduleId,
			employeeTypeId,
			actorOid
		});

		const versionsAfter = await loadVersions(tx, scheduleId, employeeTypeId);
		const newPrimaryStart = versionsAfter[0]?.startDate ?? oldPrimaryStart;
		if (newPrimaryStart !== oldPrimaryStart) {
			await registerAppendShiftOrderForMonth({
				runner: tx,
				scheduleId,
				monthStart: monthStartForDate(newPrimaryStart),
				employeeTypeId,
				actorOid
			});
		}

		await tx.commit();
	} catch (err) {
		try {
			await tx.rollback();
		} catch {
			// keep original error
		}
		throw err;
	}

	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ locals, cookies, request }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const { pool, scheduleId, actorOid } = await getActorContext(currentUser.id, cookies);
	const body = (await request.json().catch(() => null)) as RemoveShiftPayload | null;
	const employeeTypeId = cleanEmployeeTypeId(body?.employeeTypeId);
	const editMode =
		typeof body?.editMode === 'string' && body.editMode.trim().toLowerCase() === 'history'
			? 'history'
			: 'timeline';
	const changeStartDate =
		editMode === 'history' ? cleanDateOnly(body?.changeStartDate, 'Change start date') : null;
	const confirmUsedShiftRemoval = cleanBoolean(body?.confirmUsedShiftRemoval);

	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		await ensureShiftExists(tx, scheduleId, employeeTypeId);

		if (editMode === 'history' && changeStartDate) {
			const exists = await req(tx)
				.input('scheduleId', scheduleId)
				.input('employeeTypeId', employeeTypeId)
				.input('changeStartDate', changeStartDate)
				.query(
					`SELECT TOP (1) StartDate
					 FROM dbo.EmployeeTypeVersions
					 WHERE ScheduleId = @scheduleId
					   AND EmployeeTypeId = @employeeTypeId
					   AND StartDate = @changeStartDate
					   AND IsActive = 1
					   AND DeletedAt IS NULL;`
				);
			if (!exists.recordset?.[0]?.StartDate) {
				throw error(404, 'Shift change entry not found');
			}

			await req(tx)
				.input('scheduleId', scheduleId)
				.input('employeeTypeId', employeeTypeId)
				.input('changeStartDate', changeStartDate)
				.query(
					`DELETE FROM dbo.EmployeeTypeVersions
					 WHERE ScheduleId = @scheduleId
					   AND EmployeeTypeId = @employeeTypeId
					   AND StartDate = @changeStartDate
					   AND IsActive = 1
					   AND DeletedAt IS NULL;`
				);

			await syncShiftMainFromVersions({
				runner: tx,
				scheduleId,
				employeeTypeId,
				actorOid
			});

			await tx.commit();
			return json({ success: true, removalMode: 'history_removed' });
		}

		const assignmentStats = await req(tx)
			.input('scheduleId', scheduleId)
			.input('employeeTypeId', employeeTypeId)
			.query(
				`SELECT COUNT(*) AS AssignmentCount
				 FROM dbo.ScheduleUserTypes
				 WHERE ScheduleId = @scheduleId
				   AND EmployeeTypeId = @employeeTypeId
				   AND IsActive = 1
				   AND DeletedAt IS NULL;`
			);
		const hasEverBeenInUse = Number(assignmentStats.recordset?.[0]?.AssignmentCount ?? 0) > 0;

		if (hasEverBeenInUse && !confirmUsedShiftRemoval) {
			const impactCounts = await req(tx)
				.input('scheduleId', scheduleId)
				.input('employeeTypeId', employeeTypeId)
				.query(
					`SELECT
						(SELECT COUNT(*) FROM dbo.ScheduleUserTypes
						 WHERE ScheduleId = @scheduleId AND EmployeeTypeId = @employeeTypeId
						   AND IsActive = 1 AND DeletedAt IS NULL) AS AssignmentCount,
						(SELECT COUNT(*) FROM dbo.ScheduleEvents
						 WHERE ScheduleId = @scheduleId AND EmployeeTypeId = @employeeTypeId
						   AND IsActive = 1 AND DeletedAt IS NULL) AS ShiftEventCount,
						(SELECT COUNT(*) FROM dbo.EmployeeTypeVersions
						 WHERE ScheduleId = @scheduleId AND EmployeeTypeId = @employeeTypeId
						   AND IsActive = 1 AND DeletedAt IS NULL) AS ShiftChangeCount;`
				);

			await tx.rollback();
			return json(
				{
					code: 'SHIFT_IN_USE_CONFIRMATION',
					message:
						'This shift has been used in assignments. Deleting it will permanently remove assignment and related event history.',
					assignmentCount: Number(impactCounts.recordset?.[0]?.AssignmentCount ?? 0),
					shiftEventCount: Number(impactCounts.recordset?.[0]?.ShiftEventCount ?? 0),
					shiftChangeCount: Number(impactCounts.recordset?.[0]?.ShiftChangeCount ?? 0)
				},
				{ status: 409 }
			);
		}

		const firstStart = await req(tx)
			.input('scheduleId', scheduleId)
			.input('employeeTypeId', employeeTypeId)
			.query(
				`SELECT TOP (1) StartDate
				 FROM dbo.EmployeeTypeVersions
				 WHERE ScheduleId = @scheduleId
				   AND EmployeeTypeId = @employeeTypeId
				   AND IsActive = 1
				   AND DeletedAt IS NULL
				 ORDER BY StartDate ASC;`
			);
		const removalStartDate = toDateOnly(firstStart.recordset?.[0]?.StartDate) ?? new Date().toISOString().slice(0, 10);

		await req(tx)
			.input('scheduleId', scheduleId)
			.input('employeeTypeId', employeeTypeId)
			.query(
				`DELETE se
				 FROM dbo.ScheduleEvents se
				 WHERE se.ScheduleId = @scheduleId
				   AND se.UserOid IS NOT NULL
				   AND se.IsActive = 1
				   AND se.DeletedAt IS NULL
				   AND EXISTS (
						SELECT 1
						FROM dbo.ScheduleUserTypes sut
						WHERE sut.ScheduleId = @scheduleId
						  AND sut.EmployeeTypeId = @employeeTypeId
						  AND sut.UserOid = se.UserOid
						  AND sut.IsActive = 1
						  AND sut.DeletedAt IS NULL
						  AND se.StartDate <= ISNULL(sut.EndDate, '9999-12-31')
						  AND se.EndDate >= sut.StartDate
				   );

				 DELETE FROM dbo.ScheduleEvents
				 WHERE ScheduleId = @scheduleId
				   AND EmployeeTypeId = @employeeTypeId
				   AND IsActive = 1
				   AND DeletedAt IS NULL;

				 DELETE FROM dbo.ScheduleUserTypes
				 WHERE ScheduleId = @scheduleId
				   AND EmployeeTypeId = @employeeTypeId
				   AND IsActive = 1
				   AND DeletedAt IS NULL;

				 DELETE FROM dbo.EmployeeTypeVersions
				 WHERE ScheduleId = @scheduleId
				   AND EmployeeTypeId = @employeeTypeId;

				 DELETE FROM dbo.ShiftOrderMonthItems
				 WHERE ScheduleId = @scheduleId
				   AND EmployeeTypeId = @employeeTypeId;

				 DELETE FROM dbo.EmployeeTypes
				 WHERE ScheduleId = @scheduleId
				   AND EmployeeTypeId = @employeeTypeId;`
			);

		await req(tx)
			.input('scheduleId', scheduleId)
			.query(
				`WITH Ordered AS (
					SELECT
						ScheduleId,
						EffectiveMonth,
						EmployeeTypeId,
						ROW_NUMBER() OVER (
							PARTITION BY ScheduleId, EffectiveMonth
							ORDER BY DisplayOrder ASC, EmployeeTypeId ASC
						) AS NextDisplayOrder
					FROM dbo.ShiftOrderMonthItems
					WHERE ScheduleId = @scheduleId
				)
				UPDATE soi
				SET DisplayOrder = o.NextDisplayOrder,
					UpdatedAt = SYSUTCDATETIME(),
					UpdatedBy = NULL
				FROM dbo.ShiftOrderMonthItems soi
				INNER JOIN Ordered o
				  ON o.ScheduleId = soi.ScheduleId
				 AND o.EffectiveMonth = soi.EffectiveMonth
				 AND o.EmployeeTypeId = soi.EmployeeTypeId
				WHERE soi.DisplayOrder <> o.NextDisplayOrder;

				DELETE som
				FROM dbo.ShiftOrderMonths som
				WHERE som.ScheduleId = @scheduleId
				  AND NOT EXISTS (
					SELECT 1
					FROM dbo.ShiftOrderMonthItems soi
					WHERE soi.ScheduleId = som.ScheduleId
					  AND soi.EffectiveMonth = som.EffectiveMonth
				  );`
			);

		await registerRemoveShiftOrderForMonth({
			runner: tx,
			scheduleId,
			monthStart: monthStartForDate(removalStartDate),
			employeeTypeId,
			actorOid
		});

		await tx.commit();
		return json({ success: true, removalMode: 'hard_deleted' });
	} catch (err) {
		try {
			await tx.rollback();
		} catch {
			// keep original error
		}
		throw err;
	}
};
