<script lang="ts">
	import { afterUpdate, onDestroy, onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import MonthYearBar from '$lib/components/MonthYearBar.svelte';
	import ScheduleGrid from '$lib/components/ScheduleGrid.svelte';
	import TeamSetupModal from '$lib/components/TeamSetupModal.svelte';
	import ScheduleSetupModal from '$lib/components/ScheduleSetupModal.svelte';
	import OnboardingTourModal from '$lib/components/OnboardingTourModal.svelte';
	import type { Employee, Group, ScheduleEvent, Status } from '$lib/types/schedule';
	import { fetchWithAuthRedirect } from '$lib/utils/fetchWithAuthRedirect';
	import { buildMonthDays, monthNames } from '$lib/utils/date';

	type Theme = 'light' | 'dark';
	type ThemePreference = 'system' | 'dark' | 'light';
	type ScheduleRole = 'Member' | 'Maintainer' | 'Manager';
	type ScheduleMembership = {
		ScheduleId: number;
		Name: string;
		RoleName: ScheduleRole;
		IsDefault: boolean;
		IsActive: boolean;
		ThemeJson?: string | null;
		VersionAt?: string | Date | null;
	};
	type OnboardingSlide = {
		id: string;
		role: ScheduleRole;
		roleTier: number;
		title: string;
		description: string;
		imageUrl: string | null;
	};
	type ThemeMode = 'dark' | 'light';
	type ThemeFieldKey =
		| 'background'
		| 'text'
		| 'accent'
		| 'todayColor'
		| 'weekendColor'
		| 'weekdayColor'
		| 'pageBorderColor'
		| 'scheduleBorderColor'
		| 'primaryGradient1'
		| 'primaryGradient2'
		| 'secondaryGradient1'
		| 'secondaryGradient2';
	type ThemeDraft = Record<ThemeFieldKey, string>;
	type ThemePayload = Record<ThemeMode, ThemeDraft>;

	const now = () => new Date();
	const initialDate = now();
	const themeFieldKeys: ThemeFieldKey[] = [
		'background',
		'text',
		'accent',
		'todayColor',
		'weekendColor',
		'weekdayColor',
		'pageBorderColor',
		'scheduleBorderColor',
		'primaryGradient1',
		'primaryGradient2',
		'secondaryGradient1',
		'secondaryGradient2'
	];
	const themeOverrideSuffixes = [
		'bg-0',
		'bg-1',
		'bg-2',
		'surface-0',
		'surface-1',
		'surface-2',
		'text',
		'muted',
		'faint',
		'grid-1',
		'grid-2',
		'accent',
		'accent-1',
		'accent-2',
		'accent-3',
		'today',
		'today-header-bg',
		'focus-ring',
		'interactive-bg',
		'interactive-bg-hover',
		'interactive-border',
		'interactive-border-hover',
		'team-cell-hover',
		'team-cell-active',
		'modal-backdrop',
		'modal-border',
		'panel-bg',
		'table-header-bg',
		'input-bg',
		'scrollbar-track-bg',
		'scrollbar-thumb-bg',
		'scrollbar-thumb-bg-hover',
		'border-color',
		'border-accent-soft',
		'border-accent-medium',
		'border-accent-strong',
		'border-accent-focus',
		'table-weekday-bg',
		'table-weekend-bg',
		'table-border-color',
		'table-header-gradient-start',
		'table-header-gradient-end',
		'table-team-cell-bg',
		'gradient-header-start',
		'gradient-header-end',
		'gradient-modal-start',
		'gradient-modal-end',
		'gradient-popover-start',
		'gradient-popover-end',
		'gradient-primary-start',
		'gradient-primary-end'
	] as const;
	const themeOverrideVarKeys = (['dark', 'light'] as const).flatMap((mode) =>
		themeOverrideSuffixes.map((suffix) => `--theme-${mode}-${suffix}`)
	);
	const themeDefaults: Record<ThemeMode, ThemeDraft> = {
		dark: {
			background: '#07080b',
			text: '#ffffff',
			accent: '#c8102e',
			todayColor: '#c8102e',
			weekendColor: '#000000',
			weekdayColor: '#161a22',
			pageBorderColor: '#292a30',
			scheduleBorderColor: '#292a30',
			primaryGradient1: '#7a1b2c',
			primaryGradient2: '#2d1118',
			secondaryGradient1: '#361219',
			secondaryGradient2: '#0c0e12'
		},
		light: {
			background: '#f2f3f5',
			text: '#000000',
			accent: '#c8102e',
			todayColor: '#c8102e',
			weekendColor: '#d4d7de',
			weekdayColor: '#f5f6f8',
			pageBorderColor: '#bbbec6',
			scheduleBorderColor: '#bbbec6',
			primaryGradient1: '#f4d7dd',
			primaryGradient2: '#f8f9fb',
			secondaryGradient1: '#faeef0',
			secondaryGradient2: '#f5f6f8'
		}
	};
	let selectedYear = initialDate.getFullYear();
	let selectedMonthIndex = initialDate.getMonth();
	let theme: Theme = 'dark';
	let themePreferenceState: ThemePreference = 'system';
	let systemTheme: Theme = 'dark';
	let collapsed: Record<string, boolean> = {};
	let sessionCollapsedBySchedule: Record<number, Record<string, boolean>> = {};
	let persistedCollapsedBySchedule: Record<number, Record<string, boolean>> = {};
	let collapsedDefaultsSyncStateBySchedule: Record<number, 'idle' | 'syncing' | 'synced'> = {};
	let initialThemeReady = false;

	export let scheduleName = 'Shift Schedule';
	export let activeScheduleId: number | null = null;
	export let scheduleMemberships: ScheduleMembership[] = [];
	export let groups: Group[] = [];
	export let overrides: Record<string, { day: number; status: Status }[]> = {};
	export let showLegend = true;
	export let canMaintainTeam = false;
	export let canAssignManagerRole = false;
	export let canOpenScheduleSetup = false;
	export let currentUserOid = '';
	export let collapsedGroupsBySchedule: Record<number, Record<string, boolean>> = {};
	export let themePreference: ThemePreference = 'system';
	export let onboarding: { currentTier: number; targetTier: number; slides: OnboardingSlide[] } = {
		currentTier: 0,
		targetTier: 0,
		slides: []
	};

	let teamSetupOpen = false;
	let scheduleSetupOpen = false;
	let cardScrollEl: HTMLDivElement | null = null;
	let appRailEl: HTMLDivElement | null = null;
	let showAppScrollbar = false;
	let appThumbHeightPx = 0;
	let appThumbTopPx = 0;
	let isDraggingAppScrollbar = false;
	let appDragStartY = 0;
	let appDragStartThumbTopPx = 0;
	let lastSyncedActiveScheduleId: number | null = null;
	let scheduleGroups: Group[] = [];
	let scheduleEvents: ScheduleEvent[] = [];
	let scheduleGroupsLoaded = false;
	let scheduleGroupsRequestId = 0;
	let scheduleLoadKey = '';
	let isScheduleTransitioning = false;
	let lastRequestedMonthViewKey = `${selectedYear}-${selectedMonthIndex}`;
	let activeScheduleThemeSignature = '';
	let lastAppliedThemeSignature = '';
	let scheduleContextPollTimer: ReturnType<typeof setInterval> | null = null;
	let scheduleContextRefreshInFlight = false;
	let displayNameEditorOpen = false;
	let displayNameEditorUserOid = '';
	let displayNameEditorCurrentName = '';
	let displayNameEditorDraft = '';
	let displayNameEditorError = '';
	let displayNameEditorSaving = false;
	let onboardingOpen = false;
	let onboardingSlideIndex = 0;
	let onboardingDontShowAgain = false;
	let onboardingSaving = false;
	let onboardingDismissedForSession = false;
	let onboardingSaveError = '';
	let onboardingSlidesSource: 'auto' | 'manual' = 'auto';
	let onboardingSlidesForModal: OnboardingSlide[] = onboarding.slides;
	let onboardingTargetTierForModal = onboarding.targetTier;
	let onboardingCurrentTierState = onboarding.currentTier;
	let popupResetToken = 0;

	function normalizeHexColor(value: string, fallback: string): string {
		const trimmed = value.trim().toLowerCase();
		const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
		if (hexMatch) {
			const hexValue = hexMatch[1];
			if (hexValue.length === 3) {
				return `#${hexValue
					.split('')
					.map((part) => `${part}${part}`)
					.join('')}`;
			}
			return `#${hexValue}`;
		}
		return fallback;
	}

	function hexToRgb(color: string): { r: number; g: number; b: number } {
		const normalized = normalizeHexColor(color, '#000000').slice(1);
		return {
			r: Number.parseInt(normalized.slice(0, 2), 16),
			g: Number.parseInt(normalized.slice(2, 4), 16),
			b: Number.parseInt(normalized.slice(4, 6), 16)
		};
	}

	function rgbToHex(r: number, g: number, b: number): string {
		return `#${[r, g, b]
			.map((value) =>
				Math.max(0, Math.min(255, Math.round(value)))
					.toString(16)
					.padStart(2, '0')
			)
			.join('')}`;
	}

	function mixColors(base: string, mixWith: string, weight: number): string {
		const left = hexToRgb(base);
		const right = hexToRgb(mixWith);
		const safeWeight = Math.max(0, Math.min(1, weight));
		return rgbToHex(
			left.r * (1 - safeWeight) + right.r * safeWeight,
			left.g * (1 - safeWeight) + right.g * safeWeight,
			left.b * (1 - safeWeight) + right.b * safeWeight
		);
	}

	function rgba(color: string, alpha: number): string {
		const { r, g, b } = hexToRgb(color);
		const safeAlpha = Math.max(0, Math.min(1, alpha));
		return `rgba(${r}, ${g}, ${b}, ${safeAlpha.toFixed(2)})`;
	}

	function buildModeOverrides(mode: ThemeMode, modeTheme: ThemeDraft): Record<string, string> {
		const defaults = themeDefaults[mode];
		const background = normalizeHexColor(modeTheme.background, defaults.background);
		const text = normalizeHexColor(modeTheme.text, defaults.text);
		const accent = normalizeHexColor(modeTheme.accent, defaults.accent);
		const todayColor = normalizeHexColor(modeTheme.todayColor, defaults.todayColor);
		const weekendColor = normalizeHexColor(modeTheme.weekendColor, defaults.weekendColor);
		const weekdayColor = normalizeHexColor(modeTheme.weekdayColor, defaults.weekdayColor);
		const pageBorderColor = normalizeHexColor(modeTheme.pageBorderColor, defaults.pageBorderColor);
		const scheduleBorderColor = normalizeHexColor(
			modeTheme.scheduleBorderColor,
			defaults.scheduleBorderColor
		);
		const primaryGradientFrom = normalizeHexColor(
			modeTheme.primaryGradient1,
			defaults.primaryGradient1
		);
		const primaryGradientTo = normalizeHexColor(
			modeTheme.primaryGradient2,
			defaults.primaryGradient2
		);
		const secondaryGradientFrom = normalizeHexColor(
			modeTheme.secondaryGradient1,
			defaults.secondaryGradient1
		);
		const secondaryGradientTo = normalizeHexColor(
			modeTheme.secondaryGradient2,
			defaults.secondaryGradient2
		);
		const isDark = mode === 'dark';
		const bgWeight1 = isDark ? 0.14 : 0.08;
		const bgWeight2 = isDark ? 0.24 : 0.16;
		const surface = isDark
			? mixColors(background, '#ffffff', 0.08)
			: mixColors(background, '#000000', 0.04);
		const surfaceAlpha0 = isDark ? 0.22 : 0.62;
		const surfaceAlpha1 = isDark ? 0.34 : 0.74;
		const surfaceAlpha2 = isDark ? 0.5 : 0.84;
		const textAlpha = isDark ? 0.98 : 0.92;
		const mutedAlpha = isDark ? 0.72 : 0.66;
		const faintAlpha = isDark ? 0.5 : 0.46;
		const todayAlpha = isDark ? 0.24 : 0.2;
		const interactiveAlpha = isDark ? 0.06 : 0.72;
		const interactiveHoverAlpha = isDark ? 0.09 : 0.86;
		const cellActiveAlpha = isDark ? 0.2 : 0.15;
		const backdropAlpha = isDark ? 0.68 : 0.42;
		const panelAlpha = isDark ? 0.38 : 0.88;
		const inputAlpha = isDark ? 0.08 : 0.95;
		const scrollThumbAlpha = isDark ? 0.38 : 0.24;
		const scrollThumbHoverAlpha = isDark ? 0.56 : 0.34;
		const border = pageBorderColor;
		const headerGradientBottom = mixColors(weekdayColor, '#000000', isDark ? 0.24 : 0.12);
		const teamCellColor = mixColors(weekdayColor, '#000000', isDark ? 0.32 : 0.16);
		const headerGradientFrom = primaryGradientFrom;
		const headerGradientTo = primaryGradientTo;
		const modalGradientFrom = secondaryGradientFrom;
		const modalGradientTo = secondaryGradientTo;
		const popoverGradientFrom = secondaryGradientFrom;
		const popoverGradientTo = secondaryGradientTo;

		return {
			[`--theme-${mode}-bg-0`]: background,
			[`--theme-${mode}-bg-1`]: mixColors(background, '#ffffff', bgWeight1),
			[`--theme-${mode}-bg-2`]: mixColors(background, '#ffffff', bgWeight2),
			[`--theme-${mode}-surface-0`]: rgba(surface, surfaceAlpha0),
			[`--theme-${mode}-surface-1`]: rgba(surface, surfaceAlpha1),
			[`--theme-${mode}-surface-2`]: rgba(surface, surfaceAlpha2),
			[`--theme-${mode}-text`]: rgba(text, textAlpha),
			[`--theme-${mode}-muted`]: rgba(text, mutedAlpha),
			[`--theme-${mode}-faint`]: rgba(text, faintAlpha),
			[`--theme-${mode}-grid-1`]: rgba(text, isDark ? 0.11 : 0.12),
			[`--theme-${mode}-grid-2`]: rgba(text, isDark ? 0.06 : 0.08),
			[`--theme-${mode}-accent`]: accent,
			[`--theme-${mode}-accent-1`]: rgba(accent, 0.62),
			[`--theme-${mode}-accent-2`]: rgba(accent, 0.3),
			[`--theme-${mode}-accent-3`]: rgba(accent, 0.15),
			[`--theme-${mode}-today`]: rgba(todayColor, todayAlpha),
			[`--theme-${mode}-today-header-bg`]: rgba(todayColor, 0.33),
			[`--theme-${mode}-focus-ring`]: `0 0 0 3px ${rgba(accent, 0.22)}`,
			[`--theme-${mode}-interactive-bg`]: isDark
				? rgba('#ffffff', interactiveAlpha)
				: rgba('#ffffff', interactiveAlpha),
			[`--theme-${mode}-interactive-bg-hover`]: isDark
				? rgba('#ffffff', interactiveHoverAlpha)
				: rgba('#ffffff', interactiveHoverAlpha),
			[`--theme-${mode}-interactive-border`]: isDark ? rgba(border, 0.32) : rgba(border, 0.28),
			[`--theme-${mode}-interactive-border-hover`]: rgba(accent, interactiveHoverAlpha),
			[`--theme-${mode}-team-cell-hover`]: rgba(accent, 0.12),
			[`--theme-${mode}-team-cell-active`]: rgba(accent, cellActiveAlpha),
			[`--theme-${mode}-modal-backdrop`]: rgba('#000000', backdropAlpha),
			[`--theme-${mode}-modal-border`]: isDark ? rgba(border, 0.38) : rgba(border, 0.3),
			[`--theme-${mode}-panel-bg`]: rgba('#ffffff', panelAlpha),
			[`--theme-${mode}-table-header-bg`]: isDark
				? `linear-gradient(180deg, ${rgba(headerGradientFrom, 0.64)}, ${rgba(headerGradientTo, 0.38)})`
				: `linear-gradient(180deg, ${rgba(headerGradientFrom, 0.72)}, ${rgba(headerGradientTo, 0.48)})`,
			[`--theme-${mode}-input-bg`]: rgba('#ffffff', inputAlpha),
			[`--theme-${mode}-scrollbar-track-bg`]: isDark
				? rgba('#ffffff', 0.08)
				: rgba('#000000', 0.08),
			[`--theme-${mode}-scrollbar-thumb-bg`]: rgba(accent, scrollThumbAlpha),
			[`--theme-${mode}-scrollbar-thumb-bg-hover`]: rgba(accent, scrollThumbHoverAlpha),
			[`--theme-${mode}-border-color`]: border,
			[`--theme-${mode}-border-accent-soft`]: rgba(border, 0.26),
			[`--theme-${mode}-border-accent-medium`]: rgba(border, 0.42),
			[`--theme-${mode}-border-accent-strong`]: rgba(border, 0.55),
			[`--theme-${mode}-border-accent-focus`]: rgba(border, 0.72),
			[`--theme-${mode}-table-weekday-bg`]: rgba(weekdayColor, 1),
			[`--theme-${mode}-table-weekend-bg`]: rgba(weekendColor, 1),
			[`--theme-${mode}-table-border-color`]: rgba(scheduleBorderColor, 1),
			[`--theme-${mode}-table-header-gradient-start`]: rgba(weekdayColor, 1),
			[`--theme-${mode}-table-header-gradient-end`]: rgba(headerGradientBottom, 1),
			[`--theme-${mode}-table-team-cell-bg`]: rgba(teamCellColor, 1),
			[`--theme-${mode}-gradient-header-start`]: headerGradientFrom,
			[`--theme-${mode}-gradient-header-end`]: headerGradientTo,
			[`--theme-${mode}-gradient-modal-start`]: modalGradientFrom,
			[`--theme-${mode}-gradient-modal-end`]: modalGradientTo,
			[`--theme-${mode}-gradient-popover-start`]: popoverGradientFrom,
			[`--theme-${mode}-gradient-popover-end`]: popoverGradientTo,
			[`--theme-${mode}-gradient-primary-start`]: primaryGradientFrom,
			[`--theme-${mode}-gradient-primary-end`]: primaryGradientTo
		};
	}

	function parseThemePayload(themeJson: string | null | undefined): ThemePayload | null {
		if (typeof themeJson !== 'string' || !themeJson.trim()) return null;
		try {
			const parsed = JSON.parse(themeJson) as Record<string, unknown>;
			if (!parsed || typeof parsed !== 'object') return null;
			const dark = parsed.dark as Record<string, unknown> | undefined;
			const light = parsed.light as Record<string, unknown> | undefined;
			if (!dark || !light) return null;

			const parseMode = (
				modeValue: Record<string, unknown>,
				modeDefaults: ThemeDraft
			): ThemeDraft => {
				const mode = {} as ThemeDraft;
				for (const key of themeFieldKeys) {
					const value =
						modeValue[key] ??
						((key === 'pageBorderColor' || key === 'scheduleBorderColor'
							? modeValue.borderColor
							: undefined) as unknown);
					mode[key] =
						typeof value === 'string'
							? normalizeHexColor(value, modeDefaults[key])
							: modeDefaults[key];
				}
				return mode;
			};

			const parsedDark = parseMode(dark, themeDefaults.dark);
			const parsedLight = parseMode(light, themeDefaults.light);

			return { dark: parsedDark, light: parsedLight };
		} catch {
			return null;
		}
	}

	function clearThemeOverrides() {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		for (const key of themeOverrideVarKeys) {
			root.style.removeProperty(key);
		}
	}

	function applyThemeOverrides(themePayload: ThemePayload) {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		const darkVars = buildModeOverrides('dark', themePayload.dark);
		const lightVars = buildModeOverrides('light', themePayload.light);
		for (const [key, value] of Object.entries({ ...darkVars, ...lightVars })) {
			root.style.setProperty(key, value);
		}
	}

	function applyActiveScheduleTheme() {
		const activeMembership =
			scheduleMemberships.find((membership) => membership.ScheduleId === activeScheduleId) ??
			scheduleMemberships.find((membership) => membership.IsDefault) ??
			scheduleMemberships[0] ??
			null;
		if (!activeMembership) {
			clearThemeOverrides();
			return;
		}
		const parsed = parseThemePayload(activeMembership.ThemeJson);
		if (!parsed) {
			clearThemeOverrides();
			return;
		}
		applyThemeOverrides(parsed);
	}

	function normalizeVersionAt(value: unknown): string {
		if (value instanceof Date) {
			return Number.isFinite(value.getTime()) ? value.toISOString() : '';
		}
		if (typeof value !== 'string') return '';
		const trimmed = value.trim();
		if (!trimmed) return '';
		const parsed = new Date(trimmed);
		return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : trimmed;
	}

	function membershipSignature(memberships: ScheduleMembership[]): string {
		return [...memberships]
			.sort((left, right) => left.ScheduleId - right.ScheduleId)
			.map((membership) =>
				[
					membership.ScheduleId,
					membership.Name,
					membership.RoleName,
					membership.IsDefault ? '1' : '0',
					membership.IsActive ? '1' : '0',
					membership.ThemeJson ?? '',
					normalizeVersionAt(membership.VersionAt)
				].join(':')
			)
			.join('|');
	}

	function buildLoadedScheduleContextSignature(
		nextActiveScheduleId: number | null,
		nextMemberships: ScheduleMembership[]
	): string {
		return `${nextActiveScheduleId ?? 'none'}|${membershipSignature(nextMemberships)}`;
	}

	function accessLevelSignature(memberships: ScheduleMembership[]): string {
		return [...memberships]
			.sort((left, right) => left.ScheduleId - right.ScheduleId)
			.map((membership) => [membership.ScheduleId, membership.RoleName, membership.IsActive ? '1' : '0'].join(':'))
			.join('|');
	}

	function resolveScheduleNameFromMemberships(
		memberships: ScheduleMembership[],
		resolvedScheduleId: number | null,
		fallbackName: string
	): string {
		const activeMembership =
			memberships.find((membership) => membership.ScheduleId === resolvedScheduleId) ??
			memberships.find((membership) => membership.IsDefault) ??
			memberships[0] ??
			null;
		return activeMembership?.Name?.trim() || fallbackName;
	}

	function handleScheduleMembershipsRefresh(
		nextMemberships: ScheduleMembership[],
		nextActiveScheduleId: number | null
	) {
		scheduleMemberships = nextMemberships;
		if (nextActiveScheduleId !== null) {
			activeScheduleId = nextActiveScheduleId;
		}
		scheduleName = resolveScheduleNameFromMemberships(
			nextMemberships,
			nextActiveScheduleId ?? activeScheduleId,
			scheduleName
		);
	}

	function closeAllPopups() {
		teamSetupOpen = false;
		scheduleSetupOpen = false;
		closeDisplayNameEditor(true);
		onboardingOpen = false;
		popupResetToken += 1;
	}

	async function refreshScheduleContextInBackground(): Promise<boolean> {
		if (!browser || scheduleContextRefreshInFlight) return false;
		scheduleContextRefreshInFlight = true;
		try {
			const response = await fetchWithAuthRedirect(
				`${base}/api/schedules/memberships`,
				{ headers: { accept: 'application/json' } },
				base
			);
			if (!response) return false;
			if (!response.ok) {
				if (response.status === 400 || response.status === 403) {
					await goto(`${base}/`, { invalidateAll: true, replaceState: true, noScroll: true });
					return true;
				}
				return false;
			}
			const payload = (await response.json()) as {
				activeScheduleId?: number | null;
				memberships?: ScheduleMembership[];
			};
			const serverMemberships = Array.isArray(payload.memberships) ? payload.memberships : [];
			const serverActiveScheduleId =
				typeof payload.activeScheduleId === 'number' ? payload.activeScheduleId : null;
			const currentSignature = buildLoadedScheduleContextSignature(
				activeScheduleId,
				scheduleMemberships
			);
			const serverSignature = buildLoadedScheduleContextSignature(
				serverActiveScheduleId,
				serverMemberships
			);
			const currentAccessLevelSignature = accessLevelSignature(scheduleMemberships);
			const serverAccessLevelSignature = accessLevelSignature(serverMemberships);
			if (serverAccessLevelSignature !== currentAccessLevelSignature) {
				closeAllPopups();
			}
			if (serverSignature !== currentSignature) {
				await goto(`${base}/`, { invalidateAll: true, replaceState: true, noScroll: true });
				return true;
			}
			return false;
		} catch {
			// Background refresh errors should not interrupt the current view.
			return false;
		} finally {
			scheduleContextRefreshInFlight = false;
		}
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	function setGlobalScrollbarDragging(active: boolean) {
		if (typeof document === 'undefined') return;
		const body = document.body;
		const current = Number(body.dataset.scrollbarDragCount ?? '0');
		const next = Math.max(0, current + (active ? 1 : -1));
		if (next === 0) {
			delete body.dataset.scrollbarDragCount;
		} else {
			body.dataset.scrollbarDragCount = String(next);
		}
		body.classList.toggle('scrollbar-dragging', next > 0);
	}

	function updateAppScrollbar() {
		if (!cardScrollEl) return;
		const scrollHeight = cardScrollEl.scrollHeight;
		const clientHeight = cardScrollEl.clientHeight;
		const scrollTop = cardScrollEl.scrollTop;
		const hasOverflow = scrollHeight > clientHeight + 1;
		showAppScrollbar = hasOverflow;
		if (!hasOverflow) {
			appThumbHeightPx = 0;
			appThumbTopPx = 0;
			return;
		}

		const railHeight = appRailEl?.clientHeight ?? Math.max(clientHeight - 24, 0);
		if (railHeight <= 0) return;

		const minThumbHeight = 36;
		const nextThumbHeight = Math.max(minThumbHeight, (railHeight * clientHeight) / scrollHeight);
		const maxThumbTop = Math.max(railHeight - nextThumbHeight, 0);
		const maxScrollTop = Math.max(scrollHeight - clientHeight, 1);
		const nextThumbTop = (scrollTop / maxScrollTop) * maxThumbTop;

		appThumbHeightPx = nextThumbHeight;
		appThumbTopPx = clamp(nextThumbTop, 0, maxThumbTop);
	}

	function onCardScroll() {
		if (!isDraggingAppScrollbar) {
			updateAppScrollbar();
		}
	}

	function onAppDragMove(event: MouseEvent) {
		if (!isDraggingAppScrollbar || !cardScrollEl || !appRailEl) return;
		const railHeight = appRailEl.clientHeight;
		const maxThumbTop = Math.max(railHeight - appThumbHeightPx, 0);
		const nextThumbTop = clamp(
			appDragStartThumbTopPx + (event.clientY - appDragStartY),
			0,
			maxThumbTop
		);
		const maxScrollTop = Math.max(cardScrollEl.scrollHeight - cardScrollEl.clientHeight, 0);
		appThumbTopPx = nextThumbTop;
		cardScrollEl.scrollTop = maxThumbTop > 0 ? (nextThumbTop / maxThumbTop) * maxScrollTop : 0;
	}

	function stopAppDragging() {
		if (isDraggingAppScrollbar) {
			setGlobalScrollbarDragging(false);
		}
		isDraggingAppScrollbar = false;
		if (typeof window !== 'undefined') {
			window.removeEventListener('mousemove', onAppDragMove);
			window.removeEventListener('mouseup', stopAppDragging);
		}
	}

	function startAppThumbDrag(event: MouseEvent) {
		if (!showAppScrollbar) return;
		event.preventDefault();
		event.stopPropagation();
		isDraggingAppScrollbar = true;
		setGlobalScrollbarDragging(true);
		appDragStartY = event.clientY;
		appDragStartThumbTopPx = appThumbTopPx;
		window.addEventListener('mousemove', onAppDragMove);
		window.addEventListener('mouseup', stopAppDragging);
	}

	function handleAppRailClick(event: MouseEvent) {
		if (!cardScrollEl || !appRailEl || !showAppScrollbar) return;
		if (event.target !== appRailEl) return;

		const rect = appRailEl.getBoundingClientRect();
		const desiredTop = clamp(
			event.clientY - rect.top - appThumbHeightPx / 2,
			0,
			Math.max(rect.height - appThumbHeightPx, 0)
		);
		const maxThumbTop = Math.max(rect.height - appThumbHeightPx, 1);
		const maxScrollTop = Math.max(cardScrollEl.scrollHeight - cardScrollEl.clientHeight, 0);
		cardScrollEl.scrollTop = (desiredTop / maxThumbTop) * maxScrollTop;
		updateAppScrollbar();
	}

	$: monthDays = buildMonthDays(selectedYear, selectedMonthIndex, browser ? now() : null);
	$: monthLabel = `${monthNames[selectedMonthIndex]} ${selectedYear}`;

	$: if (browser) {
		document.title = `${scheduleName} — ${monthNames[selectedMonthIndex]} ${selectedYear}`;
	}

	$: if (browser) {
		document.documentElement.dataset.theme = theme;
	}

	$: if (browser && initialThemeReady && activeScheduleId !== lastSyncedActiveScheduleId) {
		lastSyncedActiveScheduleId = activeScheduleId;
		setToToday();
	}
	$: activeScheduleThemeSignature = `${activeScheduleId ?? 'none'}|${scheduleMemberships
		.map(
			(membership) =>
				`${membership.ScheduleId}:${membership.IsDefault ? 1 : 0}:${membership.ThemeJson ?? ''}`
		)
		.join('|')}`;
	$: if (
		browser &&
		initialThemeReady &&
		activeScheduleThemeSignature !== lastAppliedThemeSignature
	) {
		lastAppliedThemeSignature = activeScheduleThemeSignature;
		applyActiveScheduleTheme();
	}

	const months = monthNames.map((label, value) => ({ label, value }));

	const years = Array.from({ length: 9 }, (_, i) => {
		const value = initialDate.getFullYear() - 3 + i;
		return { label: String(value), value };
	});

	function setTheme(next: Theme) {
		theme = next;
	}

	function resolveSystemTheme(): Theme {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
			return 'dark';
		}
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}

	function resolveEffectiveTheme(preference: ThemePreference): Theme {
		if (preference === 'system') {
			return systemTheme;
		}
		return preference;
	}

	function setThemePreferenceState(nextPreference: ThemePreference) {
		themePreferenceState = nextPreference;
		setTheme(resolveEffectiveTheme(nextPreference));
	}

	function getNextThemePreference(preference: ThemePreference): ThemePreference {
		if (preference === 'system') return 'dark';
		if (preference === 'dark') return 'light';
		return 'system';
	}

	async function persistThemePreference(nextPreference: ThemePreference): Promise<boolean> {
		try {
			const response = await fetchWithAuthRedirect(
				`${base}/api/schedules/theme-preference`,
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({ themePreference: nextPreference })
				},
				base
			);
			if (!response) return false;
			return response.ok;
		} catch {
			return false;
		}
	}

	function toggleTheme() {
		const nextPreference = getNextThemePreference(themePreferenceState);
		setThemePreferenceState(nextPreference);
		void persistThemePreference(nextPreference);
	}

	function handleScheduleSetupThemeModeChange(nextMode: ThemeMode) {
		setThemePreferenceState(nextMode);
		void persistThemePreference(nextMode);
	}

	function setToToday() {
		const d = now();
		selectedYear = d.getFullYear();
		selectedMonthIndex = d.getMonth();
	}

	function cloneCollapsedBySchedule(
		source: Record<number, Record<string, boolean>>
	): Record<number, Record<string, boolean>> {
		const output: Record<number, Record<string, boolean>> = {};
		for (const [scheduleId, groupState] of Object.entries(source)) {
			output[Number(scheduleId)] = { ...(groupState ?? {}) };
		}
		return output;
	}

	function groupCollapseKey(group: Group): string {
		if (typeof group.employeeTypeId === 'number' && Number.isInteger(group.employeeTypeId)) {
			return `shift:${group.employeeTypeId}`;
		}
		return `name:${group.category.trim().toLowerCase()}`;
	}

	function groupLegacyCollapseKey(groupName: string): string {
		return groupName.trim();
	}

	function updateSessionCollapsedState(
		scheduleId: number,
		groupKey: string,
		collapsedState: boolean
	) {
		const nextScheduleState = {
			...(sessionCollapsedBySchedule[scheduleId] ?? {}),
			[groupKey]: collapsedState
		};
		sessionCollapsedBySchedule = {
			...sessionCollapsedBySchedule,
			[scheduleId]: nextScheduleState
		};
	}

	function updatePersistedCollapsedState(
		scheduleId: number,
		groupKey: string,
		collapsedState: boolean
	) {
		const nextScheduleState = {
			...(persistedCollapsedBySchedule[scheduleId] ?? {}),
			[groupKey]: collapsedState
		};
		persistedCollapsedBySchedule = {
			...persistedCollapsedBySchedule,
			[scheduleId]: nextScheduleState
		};
	}

	function missingPersistedCollapseKeys(scheduleId: number, nextGroups: Group[]): string[] {
		const persisted = persistedCollapsedBySchedule[scheduleId] ?? {};
		const missingKeys: string[] = [];
		for (const group of nextGroups) {
			const key = groupCollapseKey(group);
			const legacyKey = groupLegacyCollapseKey(group.category);
			if (!(key in persisted) && !(legacyKey in persisted)) {
				missingKeys.push(key);
			}
		}
		return missingKeys;
	}

	function currentCollapsedForGroup(scheduleId: number, group: Group): boolean {
		const key = groupCollapseKey(group);
		const legacyKey = groupLegacyCollapseKey(group.category);
		const scheduleState = sessionCollapsedBySchedule[scheduleId] ?? {};
		if (key in scheduleState) return scheduleState[key] === true;
		if (legacyKey in scheduleState) return scheduleState[legacyKey] === true;
		return false;
	}

	function toggleGroup(group: Group) {
		if (activeScheduleId === null) return;
		const key = groupCollapseKey(group);
		const nextCollapsed = !currentCollapsedForGroup(activeScheduleId, group);
		updateSessionCollapsedState(activeScheduleId, key, nextCollapsed);
		updatePersistedCollapsedState(activeScheduleId, key, nextCollapsed);
		void persistCollapsedGroupPreference(activeScheduleId, key, nextCollapsed);
	}

	async function persistCollapsedGroupPreference(
		scheduleId: number,
		groupKey: string,
		collapsedState: boolean
	): Promise<boolean> {
		try {
			const response = await fetch(`${base}/api/schedules/collapsed-groups`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({
					scheduleId,
					groupKey,
					collapsed: collapsedState
				})
			});
			if (!response.ok) {
				throw new Error('Failed to persist collapsed-group preference');
			}
			return true;
		} catch {
			// ignore save failures and keep the local UI state
			return false;
		}
	}

	async function ensurePersistedCollapsedDefaults(scheduleId: number, nextGroups: Group[]) {
		const existingSyncState = collapsedDefaultsSyncStateBySchedule[scheduleId] ?? 'idle';
		if (existingSyncState === 'syncing' || existingSyncState === 'synced') return;
		const missingKeys = missingPersistedCollapseKeys(scheduleId, nextGroups);
		if (missingKeys.length === 0) {
			collapsedDefaultsSyncStateBySchedule = {
				...collapsedDefaultsSyncStateBySchedule,
				[scheduleId]: 'synced'
			};
			return;
		}

		collapsedDefaultsSyncStateBySchedule = {
			...collapsedDefaultsSyncStateBySchedule,
			[scheduleId]: 'syncing'
		};
		for (const key of missingKeys) {
			updatePersistedCollapsedState(scheduleId, key, false);
		}

		try {
			const results = await Promise.all(
				missingKeys.map((groupKey) => persistCollapsedGroupPreference(scheduleId, groupKey, false))
			);
			const status: 'idle' | 'synced' = results.every((result) => result) ? 'synced' : 'idle';
			collapsedDefaultsSyncStateBySchedule = {
				...collapsedDefaultsSyncStateBySchedule,
				[scheduleId]: status
			};
		} catch {
			collapsedDefaultsSyncStateBySchedule = {
				...collapsedDefaultsSyncStateBySchedule,
				[scheduleId]: 'idle'
			};
		}
	}

	function openTeamSetup() {
		if (!canMaintainTeam) return;
		teamSetupOpen = true;
	}

	function closeTeamSetup() {
		teamSetupOpen = false;
	}

	async function openScheduleSetup() {
		if (!canOpenScheduleSetup) return;
		await refreshScheduleContextInBackground();
		scheduleSetupOpen = true;
	}

	function closeScheduleSetup() {
		scheduleSetupOpen = false;
	}

	function resetOnboardingModalToServerSlides() {
		onboardingSlidesSource = 'auto';
		onboardingSlidesForModal = onboarding.slides;
		onboardingTargetTierForModal = onboarding.targetTier;
	}

	async function openOnboardingFromHelp() {
		if (onboardingSaving) return;
		onboardingSaveError = '';
		try {
			const response = await fetchWithAuthRedirect(
				`${base}/api/onboarding/slides`,
				{ headers: { accept: 'application/json' } },
				base
			);
			if (!response) return;
			if (!response.ok) {
				onboardingSaveError = 'Unable to load onboarding steps. Please try again.';
				return;
			}
			const payload = (await response.json().catch(() => null)) as
				| { slides?: OnboardingSlide[]; targetTier?: number; currentTier?: number }
				| null;
			const fetchedSlides = Array.isArray(payload?.slides) ? payload.slides : [];
			const fetchedTargetTier = Number.isInteger(payload?.targetTier)
				? Number(payload?.targetTier)
				: onboarding.targetTier;
			const fetchedCurrentTier = Number.isInteger(payload?.currentTier)
				? Number(payload?.currentTier)
				: onboardingCurrentTierState;
			onboardingSlidesSource = 'manual';
			onboardingSlidesForModal = fetchedSlides;
			onboardingTargetTierForModal = Math.max(0, Math.min(3, fetchedTargetTier));
			onboardingCurrentTierState = Math.max(
				onboardingCurrentTierState,
				Math.max(0, Math.min(3, fetchedCurrentTier))
			);
			onboardingSlideIndex = 0;
			onboardingDontShowAgain = false;
			onboardingDismissedForSession = false;
			onboardingOpen = onboardingSlidesForModal.length > 0;
			if (!onboardingOpen) {
				resetOnboardingModalToServerSlides();
			}
		} catch {
			onboardingSaveError = 'Unable to load onboarding steps. Please try again.';
		}
	}

	async function persistOnboardingToTargetRole(): Promise<boolean> {
		if (onboardingSaving || onboardingTargetTierForModal <= onboardingCurrentTierState) {
			return true;
		}
		onboardingSaving = true;
		onboardingSaveError = '';
		try {
			const response = await fetchWithAuthRedirect(
				`${base}/api/onboarding/role`,
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ onboardingRole: onboardingTargetTierForModal })
				},
				base
			);
			if (!response || !response.ok) {
				onboardingSaveError = 'Unable to save onboarding progress. Please try again.';
				return false;
			}
			onboardingCurrentTierState = Math.max(
				onboardingCurrentTierState,
				onboardingTargetTierForModal
			);
			return true;
		} finally {
			onboardingSaving = false;
		}
	}

	async function handleOnboardingClose(event: CustomEvent<{ markComplete: boolean }>) {
		const shouldMarkComplete = Boolean(event.detail?.markComplete);
		if (shouldMarkComplete) {
			const success = await persistOnboardingToTargetRole();
			if (!success) return;
		}
		onboardingOpen = false;
		onboardingDismissedForSession = true;
		onboardingDontShowAgain = false;
		onboardingSaveError = '';
		resetOnboardingModalToServerSlides();
	}

	async function handleOnboardingComplete() {
		const success = await persistOnboardingToTargetRole();
		if (!success) return;
		onboardingOpen = false;
		onboardingDismissedForSession = true;
		onboardingDontShowAgain = false;
		onboardingSaveError = '';
		resetOnboardingModalToServerSlides();
	}

	function closeDisplayNameEditor(force = false) {
		if (displayNameEditorSaving && !force) return;
		displayNameEditorOpen = false;
		displayNameEditorUserOid = '';
		displayNameEditorCurrentName = '';
		displayNameEditorDraft = '';
		displayNameEditorError = '';
	}

	function normalizeOid(value: string | null | undefined): string {
		return value?.trim().toLowerCase() ?? '';
	}

	function canEditDisplayName(employee: Employee): boolean {
		const employeeOid = employee.userOid?.trim();
		if (!employeeOid) return false;
		return normalizeOid(employeeOid) === normalizeOid(currentUserOid);
	}

	function openDisplayNameEditor(employee: Employee) {
		if (!canEditDisplayName(employee)) return;
		const userOid = employee.userOid?.trim();
		if (!userOid) return;
		displayNameEditorUserOid = userOid;
		displayNameEditorCurrentName = employee.name.trim();
		displayNameEditorDraft = employee.name.trim();
		displayNameEditorError = '';
		displayNameEditorOpen = true;
	}

	async function saveDisplayName() {
		if (!displayNameEditorOpen || displayNameEditorSaving) return;
		const nextDisplayName = displayNameEditorDraft.trim();
		if (!nextDisplayName) {
			displayNameEditorError = 'Display name is required.';
			return;
		}

		displayNameEditorSaving = true;
		displayNameEditorError = '';
		try {
			const response = await fetchWithAuthRedirect(
				`${base}/api/team/display-name`,
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({
						userOid: displayNameEditorUserOid,
						displayName: nextDisplayName
					})
				},
				base
			);
			if (!response) return;
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as { message?: string } | null;
				throw new Error(payload?.message?.trim() || 'Failed to update display name');
			}
			closeDisplayNameEditor(true);
			await refreshScheduleInBackground();
		} catch (error) {
			displayNameEditorError =
				error instanceof Error && error.message.trim().length > 0
					? error.message
					: 'Failed to update display name';
		} finally {
			displayNameEditorSaving = false;
		}
	}

	async function loadScheduleGroupsForMonth(
		year: number,
		monthIndex: number,
		withTransition = false
	) {
		if (!browser || activeScheduleId === null) {
			scheduleGroups = [];
			scheduleEvents = [];
			scheduleGroupsLoaded = true;
			isScheduleTransitioning = false;
			return;
		}

		scheduleGroupsRequestId += 1;
		const requestId = scheduleGroupsRequestId;
		if (withTransition) {
			isScheduleTransitioning = true;
		}
		try {
			const response = await fetch(
				`${base}/api/schedule/month?year=${year}&monthIndex=${monthIndex}`,
				{ headers: { accept: 'application/json' } }
			);
			if (requestId !== scheduleGroupsRequestId) return;
			if (!response.ok) {
				if (response.status === 400 || response.status === 403) {
					await goto(`${base}/`, { invalidateAll: true, replaceState: true, noScroll: true });
				}
				scheduleGroups = [];
				scheduleEvents = [];
				scheduleGroupsLoaded = true;
				return;
			}
			const payload = (await response.json()) as {
				groups?: Group[];
				events?: ScheduleEvent[];
			};
			scheduleGroups = Array.isArray(payload.groups) ? payload.groups : [];
			scheduleEvents = Array.isArray(payload.events) ? payload.events : [];
			if (activeScheduleId !== null) {
				void ensurePersistedCollapsedDefaults(activeScheduleId, scheduleGroups);
			}
			scheduleGroupsLoaded = true;
		} catch {
			if (requestId !== scheduleGroupsRequestId) return;
			scheduleGroups = [];
			scheduleEvents = [];
			scheduleGroupsLoaded = true;
		} finally {
			if (withTransition && requestId === scheduleGroupsRequestId) {
				await tick();
				await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
				if (requestId === scheduleGroupsRequestId) {
					isScheduleTransitioning = false;
				}
			}
		}
	}

	async function refreshScheduleInBackground() {
		await Promise.all([
			loadScheduleGroupsForMonth(selectedYear, selectedMonthIndex),
			refreshScheduleContextInBackground()
		]);
	}

	function syncCollapsedWithGroups(scheduleId: number, nextGroups: Group[]) {
		const nextScheduleState = { ...(sessionCollapsedBySchedule[scheduleId] ?? {}) };
		let changed = false;
		for (const group of nextGroups) {
			const key = groupCollapseKey(group);
			const legacyKey = groupLegacyCollapseKey(group.category);
			if (!(key in nextScheduleState)) {
				if (legacyKey in nextScheduleState) {
					nextScheduleState[key] = nextScheduleState[legacyKey] === true;
				} else {
					nextScheduleState[key] = false;
				}
				changed = true;
			}
		}
		if (changed) {
			sessionCollapsedBySchedule = {
				...sessionCollapsedBySchedule,
				[scheduleId]: nextScheduleState
			};
		}
	}

	$: effectiveGroups = scheduleGroupsLoaded ? scheduleGroups : groups;
	$: {
		// Keep this reactive block subscribed to collapse state changes triggered by row toggles.
		sessionCollapsedBySchedule;
		if (activeScheduleId === null) {
			collapsed = {};
		} else {
			syncCollapsedWithGroups(activeScheduleId, effectiveGroups);
			collapsed = Object.fromEntries(
				effectiveGroups.map((group) => [
					group.category,
					currentCollapsedForGroup(activeScheduleId, group)
				])
			);
		}
	}
	$: scheduleLoadKey = `${activeScheduleId ?? 'none'}:${selectedYear}-${selectedMonthIndex}`;
	$: if (browser && scheduleLoadKey) {
		const monthViewKey = `${selectedYear}-${selectedMonthIndex}`;
		const withTransition = monthViewKey !== lastRequestedMonthViewKey;
		lastRequestedMonthViewKey = monthViewKey;
		void loadScheduleGroupsForMonth(selectedYear, selectedMonthIndex, withTransition);
	}

	onMount(() => {
		document.body.classList.add('app-shell-route');
		setToToday();
		sessionCollapsedBySchedule = cloneCollapsedBySchedule(collapsedGroupsBySchedule);
		persistedCollapsedBySchedule = cloneCollapsedBySchedule(collapsedGroupsBySchedule);
		systemTheme = resolveSystemTheme();
		setThemePreferenceState(themePreference);

		let themeMediaQuery: MediaQueryList | null = null;
		const handleSystemThemeChange = (event: MediaQueryListEvent) => {
			systemTheme = event.matches ? 'dark' : 'light';
			if (themePreferenceState === 'system') {
				setTheme(systemTheme);
			}
		};
		if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
			themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
			if (typeof themeMediaQuery.addEventListener === 'function') {
				themeMediaQuery.addEventListener('change', handleSystemThemeChange);
			} else {
				themeMediaQuery.addListener(handleSystemThemeChange);
			}
		}

		applyActiveScheduleTheme();
		lastAppliedThemeSignature = activeScheduleThemeSignature;
		initialThemeReady = true;
		if (onboarding.slides.length > 0 && !onboardingDismissedForSession) {
			onboardingSlidesSource = 'auto';
			onboardingSlidesForModal = onboarding.slides;
			onboardingTargetTierForModal = onboarding.targetTier;
			onboardingOpen = true;
		}
		scheduleContextPollTimer = setInterval(() => {
			if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
			void refreshScheduleInBackground();
		}, 30000);
		const handleVisibilityOrFocus = () => {
			if (document.visibilityState === 'visible') {
				void refreshScheduleInBackground();
			}
		};
		document.addEventListener('visibilitychange', handleVisibilityOrFocus);
		window.addEventListener('focus', handleVisibilityOrFocus);
		requestAnimationFrame(updateAppScrollbar);
		const onResize = () => updateAppScrollbar();
		window.addEventListener('resize', onResize);
		return () => {
			if (scheduleContextPollTimer) {
				clearInterval(scheduleContextPollTimer);
				scheduleContextPollTimer = null;
			}
			document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
			window.removeEventListener('focus', handleVisibilityOrFocus);
			window.removeEventListener('resize', onResize);
			if (!themeMediaQuery) return;
			if (typeof themeMediaQuery.removeEventListener === 'function') {
				themeMediaQuery.removeEventListener('change', handleSystemThemeChange);
			} else {
				themeMediaQuery.removeListener(handleSystemThemeChange);
			}
		};
	});

	afterUpdate(() => {
		if (typeof window !== 'undefined') {
			requestAnimationFrame(updateAppScrollbar);
		}
	});

	onDestroy(() => {
		stopAppDragging();
		if (typeof document !== 'undefined') {
			document.body.classList.remove('app-shell-route');
		}
	});

	$: if (
		initialThemeReady &&
		onboarding.slides.length > 0 &&
		!onboardingDismissedForSession &&
		!onboardingOpen
	) {
		onboardingSlidesSource = 'auto';
		onboardingSlidesForModal = onboarding.slides;
		onboardingTargetTierForModal = onboarding.targetTier;
		onboardingOpen = true;
	}
	$: if (
		onboardingSlidesSource === 'auto' &&
		!onboardingOpen &&
		onboardingSlidesForModal !== onboarding.slides
	) {
		onboardingSlidesForModal = onboarding.slides;
		onboardingTargetTierForModal = onboarding.targetTier;
	}
	$: onboardingCurrentTierState = Math.max(onboardingCurrentTierState, onboarding.currentTier);
	$: if (onboardingSlideIndex >= onboardingSlidesForModal.length) {
		onboardingSlideIndex = Math.max(0, onboardingSlidesForModal.length - 1);
	}
</script>

{#if !initialThemeReady}
	<div class="appLoading" role="status" aria-live="polite">
		<div class="appLoadingCard">
			<div class="appLoadingSpinner" aria-hidden="true"></div>
			<div>Loading Schedule...</div>
		</div>
	</div>
{:else}
	<div class="app">
		<div class="card">
			<div class="cardScroll" bind:this={cardScrollEl} on:scroll={onCardScroll}>
				<div class="topbar">
					{#if canOpenScheduleSetup}
						<button
							type="button"
							class="title titleButton"
							on:click={openScheduleSetup}
							aria-label="Open schedule setup"
						>
							{scheduleName}
						</button>
					{:else}
						<div class="title">{scheduleName}</div>
					{/if}
					<div class="topbarActions">
						<ThemeToggle
							mode="cycle"
							themePreference={themePreferenceState}
							effectiveTheme={theme}
							onToggle={toggleTheme}
						/>
						<button
							type="button"
							class="onboardingHelpBtn"
							aria-label="Open onboarding guide"
							title="Open onboarding guide"
							on:click={openOnboardingFromHelp}
						>
							?
						</button>
					</div>
				</div>

				{#if showLegend}
					<div class="legend" aria-label="Legend">
						<span class="pill work"><span class="dot"></span>WORK</span>
						<span class="pill off"><span class="dot"></span>OFF</span>
						<span class="pill vac"><span class="dot"></span>VAC</span>
						<span class="pill hldy"><span class="dot"></span>HLDY</span>
						<span class="pill oot"><span class="dot"></span>OOT</span>
					</div>
				{/if}

				<MonthYearBar
					{monthLabel}
					{months}
					{years}
					{selectedMonthIndex}
					{selectedYear}
					onMonthSelect={(value) => (selectedMonthIndex = value)}
					onYearSelect={(value) => (selectedYear = value)}
					onToday={setToToday}
				/>

				<div class="scheduleViewport">
					<ScheduleGrid
						groups={effectiveGroups}
						events={scheduleEvents}
						{overrides}
						{collapsed}
						{monthDays}
						{selectedYear}
						{selectedMonthIndex}
						{theme}
						{popupResetToken}
						onToggleGroup={toggleGroup}
						{canMaintainTeam}
						onTeamClick={openTeamSetup}
						onEmployeeDoubleClick={openDisplayNameEditor}
						onScheduleRefresh={refreshScheduleInBackground}
					/>
					{#if isScheduleTransitioning}
						<div class="scheduleViewportLoading" role="status" aria-live="polite">
							<div class="appLoadingCard">
								<div class="appLoadingSpinner scheduleViewportSpinner" aria-hidden="true"></div>
								<div>Loading Schedule...</div>
							</div>
						</div>
					{/if}
				</div>
			</div>
			{#if showAppScrollbar}
				<div
					class="appScrollRail"
					role="presentation"
					aria-hidden="true"
					bind:this={appRailEl}
					on:mousedown={handleAppRailClick}
				>
					<div
						class="appScrollThumb"
						class:dragging={isDraggingAppScrollbar}
						role="presentation"
						style={`height:${appThumbHeightPx}px;transform:translateY(${appThumbTopPx}px);`}
						on:mousedown={startAppThumbDrag}
					></div>
				</div>
			{/if}
		</div>
	</div>

	<TeamSetupModal
		open={teamSetupOpen}
		{activeScheduleId}
		{canAssignManagerRole}
		{currentUserOid}
		onClose={closeTeamSetup}
		onScheduleRefresh={refreshScheduleInBackground}
	/>

	<ScheduleSetupModal
		open={scheduleSetupOpen}
		{activeScheduleId}
		{scheduleMemberships}
		currentThemeMode={theme}
		onThemeModeChange={handleScheduleSetupThemeModeChange}
		onMembershipsRefresh={handleScheduleMembershipsRefresh}
		onClose={closeScheduleSetup}
	/>

	{#if displayNameEditorOpen}
		<div
			class="displayNameModalBackdrop"
			role="presentation"
			on:mousedown={(event) => {
				if (event.target === event.currentTarget) {
					closeDisplayNameEditor();
				}
			}}
		>
			<div
				class="displayNameModal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="display-name-modal-title"
			>
				<h2 id="display-name-modal-title">Set Display Name - {displayNameEditorCurrentName}</h2>
				<input
					id="display-name-input"
					class="displayNameModalInput"
					type="text"
					maxlength="200"
					bind:value={displayNameEditorDraft}
					disabled={displayNameEditorSaving}
					on:keydown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							void saveDisplayName();
						}
					}}
				/>
				{#if displayNameEditorError}
					<p class="displayNameModalError" role="alert">{displayNameEditorError}</p>
				{/if}
				<div class="displayNameModalActions">
					<button
						type="button"
						class="btn actionBtn"
						on:click={closeDisplayNameEditor}
						disabled={displayNameEditorSaving}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn primary actionBtn"
						on:click={saveDisplayName}
						disabled={displayNameEditorSaving}
					>
						{displayNameEditorSaving ? 'Saving...' : 'Save'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<OnboardingTourModal
		open={onboardingOpen}
		slides={onboardingSlidesForModal}
		currentIndex={onboardingSlideIndex}
		dontShowAgain={onboardingDontShowAgain}
		isSaving={onboardingSaving}
		errorMessage={onboardingSaveError}
		on:indexChange={(event) => (onboardingSlideIndex = event.detail)}
		on:dontShowAgainChange={(event) => (onboardingDontShowAgain = event.detail)}
		on:close={handleOnboardingClose}
		on:complete={handleOnboardingComplete}
	/>
{/if}
