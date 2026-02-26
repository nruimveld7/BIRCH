import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveScheduleId } from '$lib/server/auth';
import sql from 'mssql';

type ScheduleRole = 'Member' | 'Maintainer' | 'Manager';
type OnboardingLevel = 'None' | 'Member' | 'Maintainer' | 'Manager';
type CommandAction = 'onboarding' | 'access' | 'cleanslate' | 'bootstrapstatus';

const ROLE_BY_TOKEN: Record<string, ScheduleRole> = {
	member: 'Member',
	maintainer: 'Maintainer',
	manager: 'Manager'
};

const ONBOARDING_LEVEL_BY_TOKEN: Record<string, OnboardingLevel> = {
	none: 'None',
	member: 'Member',
	maintainer: 'Maintainer',
	manager: 'Manager'
};
const ONBOARDING_TIER_BY_LEVEL: Record<OnboardingLevel, number> = {
	None: 0,
	Member: 1,
	Maintainer: 2,
	Manager: 3
};

function normalizeOid(value: string): string {
	return value.trim().toLowerCase();
}

function parseOidList(value: string | undefined): Set<string> {
	if (!value) return new Set();
	return new Set(
		value
			.split(/[,;\s]+/)
			.map((token) => token.trim())
			.filter(Boolean)
			.map((token) => normalizeOid(token))
	);
}

function parseCommand(raw: unknown):
	| { action: 'onboarding'; onboardingLevel: OnboardingLevel; command: string }
	| { action: 'access'; role: ScheduleRole; command: string }
	| { action: 'accessnone'; command: string } {
	if (typeof raw !== 'string') {
		throw error(400, 'Command is required');
	}
	const command = raw.trim();
	const match = /^(onboarding|access)\s*=\s*(none|member|maintainer|manager)$/i.exec(command);
	if (!match) {
		throw error(
			400,
			'Unsupported command. Use onboarding=<none|member|maintainer|manager>, access=<none|member|maintainer|manager>, CleanSlate, or BootstrapStatus=<1|0>.'
		);
	}

	const action = match[1].toLowerCase();
	const roleToken = match[2].toLowerCase();
	if (action === 'onboarding') {
		const onboardingLevel = ONBOARDING_LEVEL_BY_TOKEN[roleToken];
		if (!onboardingLevel) {
			throw error(400, 'Invalid onboarding level');
		}
		return { action: 'onboarding', onboardingLevel, command: `onboarding=${roleToken}` };
	}

	if (roleToken === 'none') {
		return { action: 'accessnone', command: 'access=none' };
	}

	const role = ROLE_BY_TOKEN[roleToken];
	if (!role) {
		throw error(400, 'Invalid access role');
	}

	return { action: 'access', role, command: `access=${roleToken}` };
}

function parseSimpleCommand(raw: unknown): { action: CommandAction; command: string } | null {
	if (typeof raw !== 'string') {
		return null;
	}
	const command = raw.trim().toLowerCase();
	if (command === 'cleanslate') {
		return { action: 'cleanslate', command: 'cleanslate' };
	}
	const bootstrapMatch = /^bootstrapstatus\s*=\s*([01])$/i.exec(command);
	if (bootstrapMatch) {
		return {
			action: 'bootstrapstatus',
			command: `bootstrapstatus=${bootstrapMatch[1]}`
		};
	}
	return null;
}

function assertDevConsoleAccess(userOid: string) {
	if (!dev) {
		throw error(404, 'Not found');
	}

	const configured = env.DEV_CONSOLE_ALLOWED_OIDS ?? env.BOOTSTRAP_MANAGER_OIDS;
	const allowedOids = parseOidList(configured);
	if (allowedOids.size === 0) {
		throw error(403, 'Dev console commands are not enabled');
	}
	if (!allowedOids.has(normalizeOid(userOid))) {
		throw error(403, 'You are not allowed to run dev console commands');
	}
}

async function applyOnboardingRole(params: { userOid: string; level: OnboardingLevel }) {
	const pool = await GetPool();
	const onboardingTier = ONBOARDING_TIER_BY_LEVEL[params.level];
	const result = await pool
		.request()
		.input('userOid', params.userOid)
		.input('onboardingRole', onboardingTier)
		.query(
			`UPDATE dbo.Users
			 SET OnboardingRole = @onboardingRole,
				 IsActive = 1,
				 DeletedAt = NULL,
				 DeletedBy = NULL,
				 UpdatedAt = SYSUTCDATETIME()
			 WHERE UserOid = @userOid;`
		);

	if ((result.rowsAffected?.[0] ?? 0) <= 0) {
		throw error(404, 'Current user was not found in dbo.Users');
	}

	return {
		onboardingLevel: params.level,
		onboardingTier
	};
}

async function applyAccessRole(params: { userOid: string; role: ScheduleRole; scheduleId: number }) {
	const pool = await GetPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const roleIdResult = await new sql.Request(tx).input('roleName', params.role).query(
			`SELECT TOP (1) RoleId
			 FROM dbo.Roles
			 WHERE RoleName = @roleName;`
		);
		const roleId = roleIdResult.recordset?.[0]?.RoleId;
		if (!roleId) {
			throw error(500, 'Role configuration is missing');
		}

		await new sql.Request(tx)
			.input('scheduleId', params.scheduleId)
			.input('targetUserOid', params.userOid)
			.input('actorUserOid', params.userOid)
			.query(
				`UPDATE dbo.ScheduleUsers
				 SET IsActive = 0,
					 DeletedAt = SYSUTCDATETIME(),
					 DeletedBy = @actorUserOid
				 WHERE ScheduleId = @scheduleId
				   AND UserOid = @targetUserOid
				   AND IsActive = 1
				   AND DeletedAt IS NULL;`
			);

		await new sql.Request(tx)
			.input('scheduleId', params.scheduleId)
			.input('targetUserOid', params.userOid)
			.input('roleId', roleId)
			.input('actorUserOid', params.userOid)
			.query(
				`MERGE dbo.ScheduleUsers AS target
				 USING (SELECT @scheduleId AS ScheduleId, @targetUserOid AS UserOid, @roleId AS RoleId) AS source
				 ON target.ScheduleId = source.ScheduleId
				 AND target.UserOid = source.UserOid
				 AND target.RoleId = source.RoleId
				 WHEN MATCHED THEN
				   UPDATE SET IsActive = 1,
							  DeletedAt = NULL,
							  DeletedBy = NULL,
							  GrantedAt = SYSUTCDATETIME(),
							  GrantedBy = @actorUserOid
				 WHEN NOT MATCHED THEN
				   INSERT (ScheduleId, UserOid, RoleId, GrantedBy)
				   VALUES (@scheduleId, @targetUserOid, @roleId, @actorUserOid);`
			);

		await tx.commit();
		return {
			scheduleId: params.scheduleId,
			accessRole: params.role
		};
	} catch (err) {
		await tx.rollback();
		throw err;
	}
}

async function applyAccessNone(userOid: string) {
	const pool = await GetPool();
	const result = await pool.request().input('userOid', userOid).query(
		`UPDATE dbo.ScheduleUsers
		 SET IsActive = 0,
			 DeletedAt = SYSUTCDATETIME(),
			 DeletedBy = @userOid
		 WHERE UserOid = @userOid
		   AND IsActive = 1
		   AND DeletedAt IS NULL;`
	);
	return {
		accessRole: 'None',
		rowsAffected: Number(result.rowsAffected?.[0] ?? 0)
	};
}

async function applyBootstrapStatus(userOid: string, enabled: boolean) {
	const pool = await GetPool();
	if (!enabled) {
		const result = await pool
			.request()
			.input('userOid', userOid)
			.query(
				`MERGE dbo.BootstrapManagers AS target
				 USING (SELECT @userOid AS UserOid) AS source
				 ON target.UserOid = source.UserOid
				 WHEN MATCHED THEN
				   UPDATE SET IsActive = 0,
							  DeletedAt = SYSUTCDATETIME(),
							  DeletedBy = 'dev_console_disabled'
				 WHEN NOT MATCHED THEN
				   INSERT (UserOid, Source, IsActive, DeletedAt, DeletedBy)
				   VALUES (@userOid, 'dev_console', 0, SYSUTCDATETIME(), 'dev_console_disabled');`
			);
		return {
			userOid,
			bootstrapStatus: 0,
			rowsAffected: Number(result.rowsAffected?.[0] ?? 0)
		};
	}

	await pool
		.request()
		.input('userOid', userOid)
		.query(
			`MERGE dbo.BootstrapManagers AS target
			 USING (SELECT @userOid AS UserOid) AS source
			 ON target.UserOid = source.UserOid
			 WHEN MATCHED THEN
			   UPDATE SET IsActive = 1,
						  DeletedAt = NULL,
						  DeletedBy = NULL
			 WHEN NOT MATCHED THEN
			   INSERT (UserOid, Source, IsActive)
			   VALUES (@userOid, 'dev_console', 1);`
		);

	return {
		userOid,
		bootstrapStatus: 1,
		rowsAffected: 1
	};
}

async function applyCleanSlate() {
	const pool = await GetPool();
	await pool.request().query(
		`SET NOCOUNT ON;

		 IF OBJECT_ID('dbo.ScheduleEvents', 'U') IS NOT NULL
			 DELETE FROM dbo.ScheduleEvents;
		 IF OBJECT_ID('dbo.ScheduleAssignments', 'U') IS NOT NULL
			 DELETE FROM dbo.ScheduleAssignments;
		 IF OBJECT_ID('dbo.ScheduleUserTypes', 'U') IS NOT NULL
			 DELETE FROM dbo.ScheduleUserTypes;
		 IF OBJECT_ID('dbo.ScheduleAssignmentOrders', 'U') IS NOT NULL
			 DELETE FROM dbo.ScheduleAssignmentOrders;
		 IF OBJECT_ID('dbo.ScheduleShiftOrders', 'U') IS NOT NULL
			 DELETE FROM dbo.ScheduleShiftOrders;
		 IF OBJECT_ID('dbo.ShiftEdits', 'U') IS NOT NULL
			 DELETE FROM dbo.ShiftEdits;
		 IF OBJECT_ID('dbo.Shifts', 'U') IS NOT NULL
			 DELETE FROM dbo.Shifts;
		 IF OBJECT_ID('dbo.Patterns', 'U') IS NOT NULL
			 DELETE FROM dbo.Patterns;
		 IF OBJECT_ID('dbo.EventCodes', 'U') IS NOT NULL
			 DELETE FROM dbo.EventCodes;
		 IF OBJECT_ID('dbo.CoverageCodes', 'U') IS NOT NULL
			 DELETE FROM dbo.CoverageCodes;
		 IF OBJECT_ID('dbo.ScheduleUsers', 'U') IS NOT NULL
			 DELETE FROM dbo.ScheduleUsers;
		 IF OBJECT_ID('dbo.Schedules', 'U') IS NOT NULL
			 DELETE FROM dbo.Schedules;
		 IF OBJECT_ID('dbo.BootstrapManagers', 'U') IS NOT NULL
			 DELETE FROM dbo.BootstrapManagers;
		 IF OBJECT_ID('dbo.UserSessions', 'U') IS NOT NULL
			 DELETE FROM dbo.UserSessions;
		 IF OBJECT_ID('dbo.Users', 'U') IS NOT NULL
			 DELETE FROM dbo.Users;`
	);

	return { cleared: true };
}

export const POST: RequestHandler = async ({ locals, request, cookies }) => {
	const currentUser = locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	assertDevConsoleAccess(currentUser.id);

	const body = await request.json().catch(() => null);
	const simple = parseSimpleCommand(body?.command);
	if (simple?.action === 'cleanslate') {
		const applied = await applyCleanSlate();
		return json({
			ok: true,
			command: simple.command,
			applied
		});
	}

	if (simple?.action === 'bootstrapstatus') {
		const isEnabled = simple.command.endsWith('=1');
		const applied = await applyBootstrapStatus(currentUser.id, isEnabled);
		return json({
			ok: true,
			command: simple.command,
			applied
		});
	}

	const parsed = parseCommand(body?.command);

	if (parsed.action === 'onboarding') {
		const applied = await applyOnboardingRole({
			userOid: currentUser.id,
			level: parsed.onboardingLevel
		});
		return json({
			ok: true,
			command: parsed.command,
			applied
		});
	}

	if (parsed.action === 'accessnone') {
		const applied = await applyAccessNone(currentUser.id);
		return json({
			ok: true,
			command: parsed.command,
			applied
		});
	}

	const activeScheduleId = await getActiveScheduleId(cookies);
	if (!activeScheduleId) {
		throw error(400, 'No active schedule selected');
	}

	const applied = await applyAccessRole({
		userOid: currentUser.id,
		role: parsed.role,
		scheduleId: activeScheduleId
	});

	return json({
		ok: true,
		command: parsed.command,
		applied
	});
};
