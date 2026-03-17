import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { requireChartRole } from '$lib/server/chart-access';

function parseChartId(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw error(400, 'chartId is required');
	return value;
}

function parseChartName(value: unknown): string {
	if (typeof value !== 'string') throw error(400, 'chartName is required');
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 200) throw error(400, 'chartName must be 1-200 chars');
	return trimmed;
}

function parseExpectedVersionAt(value: unknown): string | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string') throw error(400, 'expectedVersionAt is invalid');
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) throw error(400, 'expectedVersionAt is invalid');
	return parsed.toISOString();
}

function normalizeHex(value: unknown, fallback = '#c8102e'): string {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	if (/^#([0-9a-f]{6})$/i.test(trimmed)) return trimmed.toLowerCase();
	return fallback;
}

type ThemeMode = 'dark' | 'light';

type StoredThemeMode = {
	background: string;
	text: string;
	accent: string;
	pageBorderColor: string;
	primaryGradient1: string;
	primaryGradient2: string;
	secondaryGradient1: string;
	secondaryGradient2: string;
	canvasColor: string;
	canvasAccent: string;
	nodeBackground: string;
	nodeBorder: string;
	nodeConnections: string;
	nodeText: string;
	controlsBackground: string;
	controlsText: string;
	placeholder: string;
};

const themeDefaults: Record<ThemeMode, Omit<StoredThemeMode, 'placeholder'>> = {
	dark: {
		background: '#07080b',
		text: '#ffffff',
		accent: '#c8102e',
		pageBorderColor: '#292a30',
		primaryGradient1: '#7a1b2c',
		primaryGradient2: '#2d1118',
		secondaryGradient1: '#361219',
		secondaryGradient2: '#0c0e12',
		canvasColor: '#0b0d12',
		canvasAccent: '#c8102e',
		nodeBackground: '#161a22',
		nodeBorder: '#292a30',
		nodeConnections: '#c8102e',
		nodeText: '#ffffff',
		controlsBackground: '#161a22',
		controlsText: '#ffffff'
	},
	light: {
		background: '#f2f3f5',
		text: '#000000',
		accent: '#c8102e',
		pageBorderColor: '#bbbec6',
		primaryGradient1: '#f4d7dd',
		primaryGradient2: '#f8f9fb',
		secondaryGradient1: '#faeef0',
		secondaryGradient2: '#f5f6f8',
		canvasColor: '#edf0f4',
		canvasAccent: '#c8102e',
		nodeBackground: '#f5f6f8',
		nodeBorder: '#bbbec6',
		nodeConnections: '#c8102e',
		nodeText: '#000000',
		controlsBackground: '#f5f6f8',
		controlsText: '#000000'
	}
};

function normalizeThemeMode(mode: ThemeMode, value: unknown): StoredThemeMode {
	const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const defaults = themeDefaults[mode];
	const canvasAccent = normalizeHex(
		candidate.canvasAccent ?? candidate.placeholder ?? candidate.placeholderColor3,
		defaults.canvasAccent
	);
	const nodeConnections = normalizeHex(candidate.nodeConnections, canvasAccent);

	return {
		background: normalizeHex(candidate.background, defaults.background),
		text: normalizeHex(candidate.text, defaults.text),
		accent: normalizeHex(candidate.accent, defaults.accent),
		pageBorderColor: normalizeHex(
			candidate.pageBorderColor ?? candidate.borderColor,
			defaults.pageBorderColor
		),
		primaryGradient1: normalizeHex(candidate.primaryGradient1, defaults.primaryGradient1),
		primaryGradient2: normalizeHex(candidate.primaryGradient2, defaults.primaryGradient2),
		secondaryGradient1: normalizeHex(candidate.secondaryGradient1, defaults.secondaryGradient1),
		secondaryGradient2: normalizeHex(candidate.secondaryGradient2, defaults.secondaryGradient2),
		canvasColor: normalizeHex(candidate.canvasColor ?? candidate.placeholderColor2, defaults.canvasColor),
		canvasAccent,
		nodeBackground: normalizeHex(
			candidate.nodeBackground ?? candidate.placeholderColor1,
			defaults.nodeBackground
		),
		nodeBorder: normalizeHex(
			candidate.nodeBorder ?? candidate.placeholderColor4 ?? candidate.pageBorderColor,
			defaults.nodeBorder
		),
		nodeConnections,
		nodeText: normalizeHex(candidate.nodeText ?? candidate.text, defaults.nodeText),
		controlsBackground: normalizeHex(candidate.controlsBackground, defaults.controlsBackground),
		controlsText: normalizeHex(candidate.controlsText, defaults.controlsText),
		placeholder: canvasAccent
	};
}

function normalizeStoredTheme(value: unknown): Record<ThemeMode, StoredThemeMode> {
	const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	return {
		dark: normalizeThemeMode('dark', candidate.dark),
		light: normalizeThemeMode('light', candidate.light)
	};
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const body = await request.json().catch(() => null);
	const chartId = parseChartId(body?.chartId);
	const chartName = parseChartName(body?.chartName);
	const expectedVersionAt = parseExpectedVersionAt(body?.expectedVersionAt);
	const normalizedTheme = normalizeStoredTheme(body?.placeholderTheme);
	const placeholderThemeJson = JSON.stringify(normalizedTheme);

	await requireChartRole({
		userOid: user.id,
		chartId,
		minimumRole: 'Manager',
		message: 'Only chart managers can update customization'
	});

	const pool = await GetPool();
	const chartResult = await pool.request().input('chartId', chartId).query(`
		SELECT TOP (1)
			ChartId,
			COALESCE(UpdatedAt, CreatedAt) AS VersionAt
		FROM dbo.Charts
		WHERE ChartId = @chartId;
	`);
	const chart = chartResult.recordset?.[0] as
		| {
				ChartId: number;
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

	const updateResult = await pool
		.request()
		.input('chartId', chartId)
		.input('chartName', chartName)
		.input('placeholderThemeJson', placeholderThemeJson)
		.input('userOid', user.id)
		.query(`
			UPDATE dbo.Charts
			SET Name = @chartName,
				PlaceholderThemeJson = @placeholderThemeJson,
				UpdatedAt = SYSUTCDATETIME(),
				UpdatedBy = @userOid
			OUTPUT INSERTED.ChartId, COALESCE(INSERTED.UpdatedAt, INSERTED.CreatedAt) AS VersionAt
			WHERE ChartId = @chartId;
		`);
	const updated = updateResult.recordset?.[0] as
		| {
				ChartId: number;
				VersionAt: Date | null;
		  }
		| undefined;

	if (!updated) {
		return json(
			{
				code: 'CHART_CONCURRENT_MODIFICATION',
				message: 'This chart changed while you were editing. Review the latest values and retry.'
			},
			{ status: 409 }
		);
	}

	return json({
		ok: true,
		chartId: updated.ChartId,
		chartName,
		placeholderTheme: normalizedTheme,
		versionAt: updated.VersionAt ? new Date(updated.VersionAt).toISOString() : null
	});
};
