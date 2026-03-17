<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount, tick } from 'svelte';
	import ConfirmDialog, { type ConfirmDialogOption } from '$lib/components/ConfirmDialog.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import ColorPicker from '$lib/components/ColorPicker.svelte';
	import HorizontalScrollArea from '$lib/components/HorizontalScrollArea.svelte';
	import { fetchWithAuthRedirect as fetchWithAuthRedirectUtil } from '$lib/utils/fetchWithAuthRedirect';

	type ChartRole = 'Member' | 'Maintainer' | 'Manager';
	type AccessRoleLabel = ChartRole | 'Bootstrap';
	type ChartMembership = {
		ChartId: number;
		Name: string;
		RoleName: ChartRole;
		AccessRoleLabel?: AccessRoleLabel;
		IsDefault: boolean;
		IsActive: boolean;
		ThemeJson?: string | null;
		VersionAt?: string | null;
	};
	type ThemeMode = 'dark' | 'light';
	type ThemeSection = 'page' | 'canvas';
	type ThemeFieldKey =
		| 'background'
		| 'text'
		| 'accent'
		| 'pageBorderColor'
		| 'primaryGradient1'
		| 'primaryGradient2'
		| 'secondaryGradient1'
		| 'secondaryGradient2'
		| 'canvasColor'
		| 'canvasAccent'
		| 'nodeBackground'
		| 'nodeBorder'
		| 'nodeConnections'
		| 'nodeText'
		| 'controlsBackground'
		| 'controlsText';
	type ThemeDraft = Record<ThemeFieldKey, string>;
	type ThemeFieldOption = { key: ThemeFieldKey; label: string; section: ThemeSection };
	type StatusTone = 'success' | 'error' | 'info';
	type ManagerCustomizationState = {
		chartName: string;
		isActive: boolean;
		themes: Record<ThemeMode, ThemeDraft>;
		versionAt: string | null;
	};
	type ChartStateMutationResponse = {
		ok?: boolean;
		chartId?: number;
		isActive?: boolean;
		mode?: 'chart_state_updated' | 'manager_removed' | 'chart_deleted';
		versionAt?: string | null;
	};
	type ChartStateConflictResponse = {
		code?: string;
		action?: 'REMOVE_SELF' | 'DELETE_CHART';
		managerCount?: number;
		message?: string;
	};
	type ChartCustomizationMutationResponse = {
		ok?: boolean;
		chartId?: number;
		chartName?: string;
		isActive?: boolean;
		theme?: Record<ThemeMode, ThemeDraft>;
		versionAt?: string | null;
	};
	type ConfirmDialogState = {
		title: string;
		message: string;
		options: ConfirmDialogOption[];
		cancelOptionId: string;
		resolve: (optionId: string) => void;
	};

	export let open = false;
	export let activeChartId: number | null = null;
	export let chartMemberships: ChartMembership[] = [];
	export let currentThemeMode: ThemeMode = 'dark';
	export let onThemeModeChange: (nextMode: ThemeMode) => void | Promise<void> = () => {};
	export let onClose: () => void = () => {};
	export let onMembershipsRefresh: (
		memberships: ChartMembership[],
		activeChartId: number | null
	) => void | Promise<void> = () => {};
	let liveMemberships: ChartMembership[] = [];
	let membershipsLoading = false;
	let membershipsError = '';
	let hasLiveMemberships = false;
	let wasOpen = false;
	let syncSelectionToCurrentOnRefresh = false;
	let selectedChartId: number | null = null;
	let currentChartId: number | null = null;
	let selectedMembership: ChartMembership | null = null;
	let isSavingDefault = false;
	let isSwitchingChart = false;
	let isSavingManagerDraft = false;
	let isCreatingChart = false;
	let isTogglingChartState = false;
	let showCreateChartForm = false;
	let newChartName = '';
	let actionError = '';
	let effectiveMemberships: ChartMembership[] = [];
	let resolvedCurrentChartId: number | null = null;
	let isSelectedMembershipActive = false;
	let canCreateCharts = false;
	let managerSavedByChartId: Record<number, ManagerCustomizationState> = {};
	let managerDraftByChartId: Record<number, ManagerCustomizationState> = {};
	let selectedManagerSaved: ManagerCustomizationState | null = null;
	let selectedManagerDraft: ManagerCustomizationState | null = null;
	let hasManagerThemeChanges = false;
	let areAllThemeFieldsAtDefaults = true;
	let hasManagerDraftChanges = false;
	let isBootstrapOnlySelectedManager = false;
	let managerDraftStatusMessage = '';
	let managerDraftStatusTone: StatusTone = 'info';
	let managerThemesExpanded = false;
	let lastManagerSelectionId: number | null = null;
	let selectedThemeMode: ThemeMode = 'dark';
	let selectedThemeSection: ThemeSection = 'page';
	let modalScrollEl: HTMLDivElement | null = null;
	let modalEl: HTMLDivElement | null = null;
	let railEl: HTMLDivElement | null = null;
	let showCustomScrollbar = false;
	let thumbHeightPx = 0;
	let thumbTopPx = 0;
	let isDraggingScrollbar = false;
	let dragStartY = 0;
	let dragStartThumbTopPx = 0;
	let modalScrollSyncKey = '';
	let confirmDialog: ConfirmDialogState | null = null;

	const themeFieldOptions: ThemeFieldOption[] = [
		{ key: 'background', label: 'Background', section: 'page' },
		{ key: 'text', label: 'Text', section: 'page' },
		{ key: 'accent', label: 'Accent', section: 'page' },
		{ key: 'pageBorderColor', label: 'Border Color', section: 'page' },
		{ key: 'primaryGradient1', label: 'Primary Gradient 1', section: 'page' },
		{ key: 'primaryGradient2', label: 'Primary Gradient 2', section: 'page' },
		{ key: 'secondaryGradient1', label: 'Secondary Gradient 1', section: 'page' },
		{ key: 'secondaryGradient2', label: 'Secondary Gradient 2', section: 'page' },
		{ key: 'canvasColor', label: 'Canvas', section: 'canvas' },
		{ key: 'canvasAccent', label: 'Accent', section: 'canvas' },
		{ key: 'nodeBackground', label: 'Node Background', section: 'canvas' },
		{ key: 'nodeBorder', label: 'Node Border', section: 'canvas' },
		{ key: 'nodeConnections', label: 'Node Connections', section: 'canvas' },
		{ key: 'nodeText', label: 'Node Text', section: 'canvas' },
		{ key: 'controlsBackground', label: 'Controls Background', section: 'canvas' },
		{ key: 'controlsText', label: 'Controls Text', section: 'canvas' }
	];
	$: activeThemeFieldOptions = themeFieldOptions.filter(
		(themeField) => themeField.section === selectedThemeSection
	);
	$: activeThemeFieldRows = activeThemeFieldOptions.reduce<ThemeFieldOption[][]>((rows, themeField) => {
		const lastRow = rows[rows.length - 1];
		if (!lastRow || lastRow.length === 2) {
			rows.push([themeField]);
		} else {
			lastRow.push(themeField);
		}
		return rows;
	}, []);

	const themeDefaults: Record<ThemeMode, ThemeDraft> = {
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
		'canvas-background',
		'canvas-accent',
		'canvas-accent-1',
		'canvas-accent-2',
		'node-background',
		'node-border',
		'node-connection',
		'node-text',
		'controls-background',
		'controls-text',
		'placeholder-color-3',
		'placeholder-color-3-strong',
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
		'placeholder-color-1',
		'placeholder-color-2',
		'placeholder-color-4',
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

	const themeFallback: ThemeDraft = {
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
	};

	function normalizeChartId(value: unknown): number | null {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return Number(value);
		}
		if (typeof value === 'string') {
			const parsed = Number(value);
			return Number.isFinite(parsed) ? parsed : null;
		}
		return null;
	}

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

		const rgbMatch = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
		if (rgbMatch) {
			const channels = rgbMatch[1]
				.split(',')
				.slice(0, 3)
				.map((segment) => Number(segment.trim()))
				.filter((segment) => Number.isFinite(segment));
			if (channels.length === 3) {
				return `#${channels
					.map((channel) => {
						const clamped = Math.max(0, Math.min(255, Math.round(channel)));
						return clamped.toString(16).padStart(2, '0');
					})
					.join('')}`;
			}
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

	function cloneManagerState(state: ManagerCustomizationState): ManagerCustomizationState {
		return {
			chartName: state.chartName,
			isActive: state.isActive,
			versionAt: state.versionAt,
			themes: {
				dark: { ...state.themes.dark },
				light: { ...state.themes.light }
			}
		};
	}

	function areThemeDraftsEqual(a: ThemeDraft, b: ThemeDraft): boolean {
		return themeFieldOptions.every((field) => a[field.key] === b[field.key]);
	}

	function parseLegacyModeTheme(
		modeValue: Record<string, unknown>,
		modeDefaults: ThemeDraft
	): ThemeDraft {
		const legacyAccent =
			typeof modeValue.placeholder === 'string'
				? modeValue.placeholder
				: typeof modeValue.placeholderColor3 === 'string'
					? modeValue.placeholderColor3
					: modeDefaults.canvasAccent;
		const legacyNodeBorder =
			typeof modeValue.nodeBorder === 'string'
				? modeValue.nodeBorder
				: typeof modeValue.placeholderColor4 === 'string'
					? modeValue.placeholderColor4
					: typeof modeValue.pageBorderColor === 'string'
						? modeValue.pageBorderColor
						: modeDefaults.nodeBorder;

		return {
			background:
				typeof modeValue.background === 'string'
					? normalizeHexColor(modeValue.background, modeDefaults.background)
					: modeDefaults.background,
			text:
				typeof modeValue.text === 'string'
					? normalizeHexColor(modeValue.text, modeDefaults.text)
					: modeDefaults.text,
			accent:
				typeof modeValue.accent === 'string'
					? normalizeHexColor(modeValue.accent, modeDefaults.accent)
					: modeDefaults.accent,
			pageBorderColor:
				typeof modeValue.pageBorderColor === 'string'
					? normalizeHexColor(modeValue.pageBorderColor, modeDefaults.pageBorderColor)
					: modeDefaults.pageBorderColor,
			primaryGradient1:
				typeof modeValue.primaryGradient1 === 'string'
					? normalizeHexColor(modeValue.primaryGradient1, modeDefaults.primaryGradient1)
					: modeDefaults.primaryGradient1,
			primaryGradient2:
				typeof modeValue.primaryGradient2 === 'string'
					? normalizeHexColor(modeValue.primaryGradient2, modeDefaults.primaryGradient2)
					: modeDefaults.primaryGradient2,
			secondaryGradient1:
				typeof modeValue.secondaryGradient1 === 'string'
					? normalizeHexColor(modeValue.secondaryGradient1, modeDefaults.secondaryGradient1)
					: modeDefaults.secondaryGradient1,
			secondaryGradient2:
				typeof modeValue.secondaryGradient2 === 'string'
					? normalizeHexColor(modeValue.secondaryGradient2, modeDefaults.secondaryGradient2)
					: modeDefaults.secondaryGradient2,
			canvasColor:
				typeof modeValue.canvasColor === 'string'
					? normalizeHexColor(modeValue.canvasColor, modeDefaults.canvasColor)
					: typeof modeValue.placeholderColor2 === 'string'
						? normalizeHexColor(modeValue.placeholderColor2, modeDefaults.canvasColor)
						: modeDefaults.canvasColor,
			canvasAccent: normalizeHexColor(String(legacyAccent), modeDefaults.canvasAccent),
			nodeBackground:
				typeof modeValue.nodeBackground === 'string'
					? normalizeHexColor(modeValue.nodeBackground, modeDefaults.nodeBackground)
					: typeof modeValue.placeholderColor1 === 'string'
						? normalizeHexColor(modeValue.placeholderColor1, modeDefaults.nodeBackground)
						: modeDefaults.nodeBackground,
			nodeBorder: normalizeHexColor(String(legacyNodeBorder), modeDefaults.nodeBorder),
			nodeConnections:
				typeof modeValue.nodeConnections === 'string'
					? normalizeHexColor(modeValue.nodeConnections, modeDefaults.nodeConnections)
					: normalizeHexColor(String(legacyAccent), modeDefaults.nodeConnections),
			nodeText:
				typeof modeValue.nodeText === 'string'
					? normalizeHexColor(modeValue.nodeText, modeDefaults.nodeText)
					: typeof modeValue.text === 'string'
						? normalizeHexColor(modeValue.text, modeDefaults.nodeText)
						: modeDefaults.nodeText,
			controlsBackground:
				typeof modeValue.controlsBackground === 'string'
					? normalizeHexColor(modeValue.controlsBackground, modeDefaults.controlsBackground)
					: modeDefaults.controlsBackground,
			controlsText:
				typeof modeValue.controlsText === 'string'
					? normalizeHexColor(modeValue.controlsText, modeDefaults.controlsText)
					: modeDefaults.controlsText
		};
	}

	function buildModeOverrides(mode: ThemeMode, theme: ThemeDraft): Record<string, string> {
		const defaults = themeDefaults[mode];
		const background = normalizeHexColor(theme.background, defaults.background);
		const text = normalizeHexColor(theme.text, defaults.text);
		const accent = normalizeHexColor(theme.accent, defaults.accent);
		const pageBorderColor = normalizeHexColor(theme.pageBorderColor, defaults.pageBorderColor);
		const headerGradientFrom = normalizeHexColor(theme.primaryGradient1, defaults.primaryGradient1);
		const headerGradientTo = normalizeHexColor(theme.primaryGradient2, defaults.primaryGradient2);
		const modalGradientFrom = normalizeHexColor(
			theme.secondaryGradient1,
			defaults.secondaryGradient1
		);
		const modalGradientTo = normalizeHexColor(
			theme.secondaryGradient2,
			defaults.secondaryGradient2
		);
		const popoverGradientFrom = modalGradientFrom;
		const popoverGradientTo = modalGradientTo;
		const primaryGradientFrom = headerGradientFrom;
		const primaryGradientTo = headerGradientTo;
		const surface = mixColors(background, '#ffffff', mode === 'dark' ? 0.14 : 0.08);
		const canvasBackground = normalizeHexColor(theme.canvasColor, defaults.canvasColor);
		const canvasAccent = normalizeHexColor(theme.canvasAccent, defaults.canvasAccent);
		const nodeBackground = normalizeHexColor(theme.nodeBackground, defaults.nodeBackground);
		const nodeBorder = normalizeHexColor(theme.nodeBorder, defaults.nodeBorder);
		const nodeConnections = normalizeHexColor(theme.nodeConnections, defaults.nodeConnections);
		const nodeText = normalizeHexColor(theme.nodeText, defaults.nodeText);
		const controlsBackground = normalizeHexColor(
			theme.controlsBackground,
			defaults.controlsBackground
		);
		const controlsText = normalizeHexColor(theme.controlsText, defaults.controlsText);
		const border = pageBorderColor;
		const isDark = mode === 'dark';
		const headerGradientBottom = mixColors(nodeBackground, '#000000', isDark ? 0.24 : 0.12);
		const teamCellColor = mixColors(nodeBackground, '#000000', isDark ? 0.32 : 0.16);

		const bgWeight1 = isDark ? 0.08 : 0.06;
		const bgWeight2 = isDark ? 0.15 : 0.12;
		const surfaceAlpha0 = isDark ? 0.78 : 0.78;
		const surfaceAlpha1 = isDark ? 0.82 : 0.84;
		const surfaceAlpha2 = isDark ? 0.88 : 0.9;
		const textAlpha = isDark ? 0.92 : 0.86;
		const mutedAlpha = isDark ? 0.72 : 0.6;
		const faintAlpha = isDark ? 0.56 : 0.45;
		const todayAlpha = isDark ? 0.24 : 0.2;
		const interactiveHoverAlpha = isDark ? 0.5 : 0.45;
		const cellActiveAlpha = isDark ? 0.18 : 0.16;
		const panelAlpha = isDark ? 0.04 : 0.68;
		const tableHeaderAlpha = isDark ? 0.06 : 0.04;
		const inputAlpha = isDark ? 0.04 : 0.95;
		const backdropAlpha = isDark ? 0.52 : 0.22;
		const scrollTrackAlpha = isDark ? 0.04 : 0.08;
		const scrollThumbAlpha = isDark ? 0.3 : 0.34;
		const scrollThumbHoverAlpha = isDark ? 0.42 : 0.44;

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
			[`--theme-${mode}-canvas-background`]: canvasBackground,
			[`--theme-${mode}-canvas-accent`]: canvasAccent,
			[`--theme-${mode}-canvas-accent-1`]: rgba(canvasAccent, 0.62),
			[`--theme-${mode}-canvas-accent-2`]: rgba(canvasAccent, 0.3),
			[`--theme-${mode}-node-background`]: nodeBackground,
			[`--theme-${mode}-node-border`]: nodeBorder,
			[`--theme-${mode}-node-connection`]: nodeConnections,
			[`--theme-${mode}-node-text`]: rgba(nodeText, textAlpha),
			[`--theme-${mode}-controls-background`]: controlsBackground,
			[`--theme-${mode}-controls-text`]: rgba(controlsText, textAlpha),
			[`--theme-${mode}-placeholder-color-3`]: rgba(canvasAccent, todayAlpha),
			[`--theme-${mode}-placeholder-color-3-strong`]: rgba(canvasAccent, 0.33),
			[`--theme-${mode}-focus-ring`]: `0 0 0 3px ${rgba(accent, 0.22)}`,
			[`--theme-${mode}-interactive-bg`]: isDark ? rgba('#ffffff', 0.06) : rgba('#ffffff', 0.72),
			[`--theme-${mode}-interactive-bg-hover`]: isDark
				? rgba('#ffffff', 0.09)
				: rgba('#ffffff', 0.9),
			[`--theme-${mode}-interactive-border`]: isDark
				? rgba('#ffffff', 0.14)
				: rgba('#000000', 0.14),
			[`--theme-${mode}-interactive-border-hover`]: rgba(accent, interactiveHoverAlpha),
			[`--theme-${mode}-team-cell-hover`]: rgba(canvasAccent, 0.12),
			[`--theme-${mode}-team-cell-active`]: rgba(canvasAccent, cellActiveAlpha),
			[`--theme-${mode}-modal-backdrop`]: rgba('#000000', backdropAlpha),
			[`--theme-${mode}-modal-border`]: isDark ? rgba(border, 0.38) : rgba(border, 0.3),
			[`--theme-${mode}-panel-bg`]: rgba('#ffffff', panelAlpha),
			[`--theme-${mode}-table-header-bg`]: isDark
				? rgba('#ffffff', tableHeaderAlpha)
				: rgba('#000000', tableHeaderAlpha),
			[`--theme-${mode}-input-bg`]: rgba('#ffffff', inputAlpha),
			[`--theme-${mode}-scrollbar-track-bg`]: isDark
				? rgba('#ffffff', scrollTrackAlpha)
				: rgba('#000000', scrollTrackAlpha),
			[`--theme-${mode}-scrollbar-thumb-bg`]: rgba(accent, scrollThumbAlpha),
			[`--theme-${mode}-scrollbar-thumb-bg-hover`]: rgba(accent, scrollThumbHoverAlpha),
			[`--theme-${mode}-border-color`]: border,
			[`--theme-${mode}-border-accent-soft`]: rgba(border, 0.26),
			[`--theme-${mode}-border-accent-medium`]: rgba(border, 0.42),
			[`--theme-${mode}-border-accent-strong`]: rgba(border, 0.55),
			[`--theme-${mode}-border-accent-focus`]: rgba(border, 0.72),
			[`--theme-${mode}-placeholder-color-1`]: rgba(nodeBackground, 1),
			[`--theme-${mode}-placeholder-color-2`]: rgba(canvasBackground, 1),
			[`--theme-${mode}-placeholder-color-4`]: rgba(nodeBorder, 1),
			[`--theme-${mode}-table-header-gradient-start`]: rgba(nodeBackground, 1),
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

	function applyThemeState(state: ManagerCustomizationState) {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		const darkVars = buildModeOverrides('dark', state.themes.dark);
		const lightVars = buildModeOverrides('light', state.themes.light);
		for (const [key, value] of Object.entries({ ...darkVars, ...lightVars })) {
			root.style.setProperty(key, value);
		}
	}

	function clearThemeOverrides() {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		for (const varKey of themeOverrideVarKeys) {
			root.style.removeProperty(varKey);
		}
	}

	function applyActiveChartThemeOrDefault() {
		const activeId = resolvedCurrentChartId;
		if (activeId !== null) {
			const saved = managerSavedByChartId[activeId];
			if (saved) {
				applyThemeState(saved);
				return;
			}
			const activeMembership =
				effectiveMemberships.find((membership) => membership.ChartId === activeId) ?? null;
				if (activeMembership) {
					const parsedThemes = parseThemeJsonText(activeMembership.ThemeJson);
					if (parsedThemes) {
						applyThemeState({
							chartName: activeMembership.Name,
							isActive: activeMembership.IsActive,
							versionAt:
								typeof activeMembership.VersionAt === 'string'
									? activeMembership.VersionAt
									: null,
							themes: {
								dark: { ...parsedThemes.dark },
								light: { ...parsedThemes.light }
							}
						});
						return;
					}
				}
		}
		clearThemeOverrides();
	}

	function parseThemeJsonValue(value: unknown): Record<ThemeMode, ThemeDraft> | null {
		if (!value || typeof value !== 'object') return null;
		const candidate = value as Record<string, unknown>;
		const dark = candidate.dark as Record<string, unknown> | undefined;
		const light = candidate.light as Record<string, unknown> | undefined;
		if (!dark || !light) return null;

		const parsedDark = parseLegacyModeTheme(dark, themeDefaults.dark);
		const parsedLight = parseLegacyModeTheme(light, themeDefaults.light);

		return { dark: parsedDark, light: parsedLight };
	}

	function parseThemeJsonText(
		themeJson: string | null | undefined
	): Record<ThemeMode, ThemeDraft> | null {
		if (typeof themeJson !== 'string' || !themeJson.trim()) return null;
		try {
			return parseThemeJsonValue(JSON.parse(themeJson));
		} catch {
			return null;
		}
	}

	function ensureManagerState(membership: ChartMembership) {
		if (membership.RoleName !== 'Manager') return;
		const chartId = membership.ChartId;
		if (managerSavedByChartId[chartId] && managerDraftByChartId[chartId]) return;
		const parsedThemes = parseThemeJsonText(membership.ThemeJson);

		const seed: ManagerCustomizationState = {
			chartName: membership.Name,
			isActive: membership.IsActive,
			versionAt: typeof membership.VersionAt === 'string' ? membership.VersionAt : null,
			themes: {
				dark: parsedThemes ? { ...parsedThemes.dark } : { ...themeDefaults.dark },
				light: parsedThemes ? { ...parsedThemes.light } : { ...themeDefaults.light }
			}
		};
		managerSavedByChartId = {
			...managerSavedByChartId,
			[chartId]: cloneManagerState(seed)
		};
		managerDraftByChartId = {
			...managerDraftByChartId,
			[chartId]: cloneManagerState(seed)
		};
	}

	function updateManagerDraft(chartId: number, nextState: ManagerCustomizationState) {
		managerDraftByChartId = {
			...managerDraftByChartId,
			[chartId]: cloneManagerState(nextState)
		};
	}

	function displayChartName(membership: ChartMembership): string {
		return managerSavedByChartId[membership.ChartId]?.chartName ?? membership.Name;
	}

	function handleManagerNameInput(event: Event) {
		if (!selectedMembership || selectedMembership.RoleName !== 'Manager' || !selectedManagerDraft)
			return;
		const input = event.currentTarget as HTMLInputElement;
		updateManagerDraft(selectedMembership.ChartId, {
			...selectedManagerDraft,
			chartName: input.value
		});
		managerDraftStatusMessage = '';
	}

	function handleManagerThemeInput(themeKey: ThemeFieldKey, rawColor: string) {
		if (!selectedMembership || selectedMembership.RoleName !== 'Manager' || !selectedManagerDraft)
			return;
		const normalized = normalizeHexColor(rawColor, themeFallback[themeKey] ?? '#000000');
		const next: ManagerCustomizationState = {
			...selectedManagerDraft,
			themes: {
				...selectedManagerDraft.themes,
				[selectedThemeMode]: {
					...selectedManagerDraft.themes[selectedThemeMode],
					[themeKey]: normalized
				}
			}
		};
		updateManagerDraft(selectedMembership.ChartId, next);
		applyThemeState(next);
		managerDraftStatusMessage = '';
	}

	function resolveChartNameForSave(draftName: string, savedName: string): string {
		const trimmed = draftName.trim();
		return trimmed || savedName;
	}

	async function postManagerCustomizationUpdate(
		chartId: number,
		nextState: ManagerCustomizationState
	): Promise<ChartCustomizationMutationResponse> {
		const response = await fetchWithAuthRedirect(`${base}/api/charts/customization`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({
				chartId,
				chartName: nextState.chartName,
				expectedVersionAt: nextState.versionAt,
				theme: nextState.themes
			})
		});
		if (!response) {
			throw new Error('Session expired or access changed. Sign in again and retry.');
		}
		if (!response.ok) {
			if (response.status === 409) {
				const payload = (await response.json().catch(() => null)) as
					| { code?: string; message?: string }
					| null;
				if (payload?.code === 'CHART_CONCURRENT_MODIFICATION') {
					await refreshMemberships();
					throw new Error(
						payload.message?.trim() ||
							'This chart changed while you were editing. Review the latest values and retry.'
					);
				}
			}
			const message = await parseErrorMessage(
				response,
				`Failed to save customization (${response.status})`
			);
			throw new Error(message);
		}
		return (await response.json()) as ChartCustomizationMutationResponse;
	}

	async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
		let text = '';
		try {
			text = (await response.text()).trim();
		} catch {
			return fallback;
		}
		if (!text) return fallback;
		try {
			const data = JSON.parse(text) as { message?: string };
			if (typeof data.message === 'string' && data.message.trim()) {
				return data.message;
			}
		} catch {
			// treat as plain text
		}
		return text;
	}

	async function fetchWithAuthRedirect(
		input: RequestInfo | URL,
		init: RequestInit
	): Promise<Response | null> {
		const rawUrl =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const parsedUrl = new URL(rawUrl, 'http://localhost');
		if (!parsedUrl.pathname.startsWith('/api/charts')) {
			return fetchWithAuthRedirectUtil(input, init, base);
		}

		let targetPath = parsedUrl.pathname;
		let targetBody: Record<string, unknown> | null = null;
		if (typeof init.body === 'string') {
			try {
				targetBody = JSON.parse(init.body) as Record<string, unknown>;
			} catch {
				targetBody = null;
			}
		}

		if (targetPath === '/api/charts') {
			targetPath = '/api/charts';
			if (targetBody) {
				targetBody = { chartName: targetBody.chartName };
			}
		} else if (targetPath === '/api/charts/memberships') {
			targetPath = '/api/charts/memberships';
		} else if (targetPath === '/api/charts/default') {
			targetPath = '/api/charts/default';
			if (targetBody) {
				targetBody = { chartId: targetBody.chartId };
			}
		} else if (targetPath === '/api/charts/active') {
			targetPath = '/api/charts/active';
			if (targetBody) {
				targetBody = { chartId: targetBody.chartId };
			}
		} else if (targetPath === '/api/charts/state') {
			targetPath = '/api/charts/state';
			if (targetBody) {
				targetBody = {
					chartId: targetBody.chartId,
					isActive: targetBody.isActive,
					expectedVersionAt: targetBody.expectedVersionAt ?? null,
					confirmDeactivation: targetBody.confirmDeactivation === true
				};
			}
		} else if (targetPath === '/api/charts/customization') {
			targetPath = '/api/charts/customization';
			targetBody = {
				chartId: targetBody?.chartId,
				chartName: targetBody?.chartName,
				placeholderTheme: targetBody?.theme
			};
		}

		const targetUrl = `${base}${targetPath}${parsedUrl.search}`;
		const requestInit: RequestInit = {
			...init,
			body: targetBody ? JSON.stringify(targetBody) : init.body
		};
		const response = await fetchWithAuthRedirectUtil(targetUrl, requestInit, base);
		if (!response) return null;

		if (parsedUrl.pathname === '/api/charts/memberships') {
			if (!response.ok) return response;
			const payload = (await response.json()) as {
				activeChartId?: number | null;
				memberships?: Array<Record<string, unknown>>;
			};
			return new Response(
				JSON.stringify({
					activeChartId: payload.activeChartId ?? null,
					memberships: (payload.memberships ?? []).map((membership) => ({
						ChartId: Number(membership.ChartId ?? 0),
						Name: String(membership.Name ?? ''),
						RoleName: membership.RoleName,
						AccessRoleLabel:
							membership.AccessRoleLabel === 'Bootstrap' ||
							membership.AccessRoleLabel === 'Manager' ||
							membership.AccessRoleLabel === 'Maintainer' ||
							membership.AccessRoleLabel === 'Member'
								? membership.AccessRoleLabel
								: membership.RoleName === 'Manager' ||
									  membership.RoleName === 'Maintainer' ||
									  membership.RoleName === 'Member'
									? membership.RoleName
									: 'Member',
						IsDefault: Boolean(membership.IsDefault),
						IsActive: Boolean(membership.IsActive),
						ThemeJson: membership.PlaceholderThemeJson ?? null,
						VersionAt: membership.VersionAt ?? null
					}))
				}),
				{ status: response.status, headers: { 'content-type': 'application/json' } }
			);
		}

		if (parsedUrl.pathname === '/api/charts') {
			if (!response.ok) return response;
			const payload = (await response.json()) as { chartId?: number };
			return new Response(
				JSON.stringify({ chartId: payload.chartId ?? null }),
				{ status: response.status, headers: { 'content-type': 'application/json' } }
			);
		}

		if (parsedUrl.pathname === '/api/charts/customization') {
			if (!response.ok) return response;
			const payload = (await response.json()) as {
				chartId?: number;
				chartName?: string;
				versionAt?: string | null;
				placeholderTheme?: {
					dark?: { placeholder?: string };
					light?: { placeholder?: string };
				};
			};
			return new Response(
				JSON.stringify({
					ok: true,
					chartId: payload.chartId ?? null,
					chartName: payload.chartName ?? null,
					isActive: true,
					theme: {
						dark: { accent: payload.placeholderTheme?.dark?.placeholder ?? '#c8102e' },
						light: { accent: payload.placeholderTheme?.light?.placeholder ?? '#c8102e' }
					},
					versionAt:
						typeof payload.versionAt === 'string' && payload.versionAt.trim()
							? payload.versionAt
							: null
				}),
				{ status: response.status, headers: { 'content-type': 'application/json' } }
			);
		}

		if (parsedUrl.pathname === '/api/charts/state') {
			if (!response.ok) return response;
			const payload = (await response.json()) as {
				chartId?: number;
				isActive?: boolean;
				mode?: 'chart_state_updated' | 'manager_removed' | 'chart_deleted';
				versionAt?: string | null;
			};
			return new Response(
				JSON.stringify({
					ok: true,
					chartId: payload.chartId ?? null,
					isActive: Boolean(payload.isActive),
					mode: payload.mode ?? 'chart_state_updated',
					versionAt:
						typeof payload.versionAt === 'string' && payload.versionAt.trim()
							? payload.versionAt
							: null
				}),
				{ status: response.status, headers: { 'content-type': 'application/json' } }
			);
		}

		return response;
	}

	async function toggleManagerChartActive() {
		if (!selectedMembership || selectedMembership.RoleName !== 'Manager' || !selectedManagerDraft)
			return;
		if (selectedManagerDraft.isActive && isBootstrapOnlySelectedManager) return;
		if (isTogglingChartState) return;
		isTogglingChartState = true;
		actionError = '';
		managerDraftStatusMessage = '';

		const chartId = selectedMembership.ChartId;
		const nextIsActive = !selectedManagerDraft.isActive;

		try {
			const sendStateChange = async (confirmDeactivation: boolean): Promise<Response | null> =>
				fetchWithAuthRedirect(`${base}/api/charts/state`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({
						chartId,
						isActive: nextIsActive,
						expectedVersionAt: selectedManagerSaved?.versionAt ?? null,
						confirmDeactivation
					})
				});

			let response = await sendStateChange(false);
			if (!response) return;

			if (!response.ok && response.status === 409) {
				let conflict: ChartStateConflictResponse | null = null;
				try {
					conflict = (await response.json()) as ChartStateConflictResponse;
				} catch {
					conflict = null;
				}

				if (conflict?.code === 'CHART_CONCURRENT_MODIFICATION') {
					await refreshMemberships();
					throw new Error(
						conflict.message?.trim() ||
							'This chart changed while you were editing. Review the latest values and retry.'
					);
				}

				if (!nextIsActive && conflict?.code === 'CHART_DEACTIVATION_CONFIRMATION_REQUIRED') {
					const promptMessage =
						typeof conflict.message === 'string' && conflict.message.trim()
							? conflict.message
							: conflict.action === 'DELETE_CHART'
								? 'You are the last Manager for this chart. If you continue, the chart and all related data will be permanently deleted. Continue?'
								: 'This user is currently assigned to active shifts. If you continue, active assignments will end effective today and future assignments will be removed. Continue?';
					const confirmChoice = await openConfirmDialog({
						title: 'Confirm Deactivation',
						message: promptMessage,
						options: [
							{ id: 'cancel', label: 'Cancel' },
							{ id: 'continue', label: 'Continue', tone: 'danger' }
						],
						cancelOptionId: 'cancel'
					});
					if (confirmChoice !== 'continue') {
						return;
					}
					response = await sendStateChange(true);
					if (!response) return;
				}
			}

			if (!response.ok) {
				const message = await parseErrorMessage(
					response,
					`Failed to update chart state (${response.status})`
				);
				throw new Error(message);
			}

			const payload = (await response.json()) as ChartStateMutationResponse;
			if (payload.mode === 'manager_removed' || payload.mode === 'chart_deleted') {
				syncSelectionToCurrentOnRefresh = true;
				await refreshMemberships();
				await goto(`${base}/`, { invalidateAll: true });
				return;
			}

			updateManagerDraft(chartId, {
				...selectedManagerDraft,
				isActive: nextIsActive,
				versionAt:
					typeof payload.versionAt === 'string' && payload.versionAt.trim()
						? payload.versionAt
						: selectedManagerDraft.versionAt
			});
			const savedState = managerSavedByChartId[chartId];
			if (savedState) {
				managerSavedByChartId = {
					...managerSavedByChartId,
					[chartId]: {
						...savedState,
						isActive: nextIsActive,
						versionAt:
							typeof payload.versionAt === 'string' && payload.versionAt.trim()
								? payload.versionAt
								: savedState.versionAt
					}
				};
			}
			await refreshMemberships();
		} catch (errorValue) {
			actionError =
				errorValue instanceof Error ? errorValue.message : 'Failed to update chart state';
		} finally {
			isTogglingChartState = false;
		}
	}

	function handleManagerResetDefaults() {
		if (!selectedMembership || selectedMembership.RoleName !== 'Manager' || !selectedManagerDraft)
			return;
		const next: ManagerCustomizationState = {
			...selectedManagerDraft,
			themes: {
				dark: { ...themeDefaults.dark },
				light: { ...themeDefaults.light }
			}
		};
		updateManagerDraft(selectedMembership.ChartId, next);
		applyThemeState(next);
	}

	function handleManagerThemeRestoreSaved() {
		if (!selectedMembership || selectedMembership.RoleName !== 'Manager' || !selectedManagerSaved)
			return;
		const chartId = selectedMembership.ChartId;
		const draft = managerDraftByChartId[chartId];
		if (!draft) return;
		const nextDraft: ManagerCustomizationState = {
			...draft,
			themes: {
				dark: { ...selectedManagerSaved.themes.dark },
				light: { ...selectedManagerSaved.themes.light }
			}
		};
		updateManagerDraft(chartId, nextDraft);
		if (isSelectedMembershipActive) {
			applyThemeState(nextDraft);
		}
	}

	function toggleSelectedThemeMode() {
		const nextMode: ThemeMode = selectedThemeMode === 'dark' ? 'light' : 'dark';
		selectedThemeMode = nextMode;
		void onThemeModeChange(nextMode);
	}

	function toggleManagerThemesExpanded() {
		managerThemesExpanded = !managerThemesExpanded;
	}

	async function handleManagerSaveDraft() {
		if (
			!selectedMembership ||
			selectedMembership.RoleName !== 'Manager' ||
			!selectedManagerDraft ||
			!selectedManagerSaved
		)
			return;
		if (isSavingManagerDraft) return;
		if (!hasManagerDraftChanges) {
			managerDraftStatusTone = 'info';
			managerDraftStatusMessage = 'No changes to save.';
			return;
		}

		const chartId = selectedMembership.ChartId;
		const nextName = resolveChartNameForSave(
			selectedManagerDraft.chartName,
			selectedManagerSaved.chartName
		);
		const nextSaved: ManagerCustomizationState = {
			...selectedManagerSaved,
			chartName: nextName,
			themes: {
				dark: { ...selectedManagerDraft.themes.dark },
				light: { ...selectedManagerDraft.themes.light }
			}
		};
		isSavingManagerDraft = true;
		managerDraftStatusMessage = '';

		try {
			const payload = await postManagerCustomizationUpdate(chartId, nextSaved);
			const nextVersionAt =
				typeof payload.versionAt === 'string' && payload.versionAt.trim()
					? payload.versionAt
					: nextSaved.versionAt;
			const persistedState: ManagerCustomizationState = {
				...nextSaved,
				versionAt: nextVersionAt
			};
			managerSavedByChartId = {
				...managerSavedByChartId,
				[chartId]: cloneManagerState(persistedState)
			};
			managerDraftByChartId = {
				...managerDraftByChartId,
				[chartId]: cloneManagerState(persistedState)
			};
			await refreshMemberships();
			if (isSelectedMembershipActive) {
				applyThemeState(persistedState);
			}
			managerDraftStatusTone = 'success';
			managerDraftStatusMessage = 'Changes saved.';
		} catch (errorValue) {
			managerDraftStatusTone = 'error';
			managerDraftStatusMessage =
				errorValue instanceof Error ? errorValue.message : 'Failed to save customization';
		} finally {
			isSavingManagerDraft = false;
		}
	}

	function closeModal() {
		onClose();
	}

	function closeConfirmDialog(optionId: string) {
		const resolver = confirmDialog?.resolve;
		confirmDialog = null;
		if (resolver) resolver(optionId);
	}

	async function openConfirmDialog(config: {
		title: string;
		message: string;
		options: ConfirmDialogOption[];
		cancelOptionId: string;
	}): Promise<string> {
		if (confirmDialog) {
			closeConfirmDialog(confirmDialog.cancelOptionId);
		}
		return new Promise<string>((resolve) => {
			confirmDialog = {
				title: config.title,
				message: config.message,
				options: config.options,
				cancelOptionId: config.cancelOptionId,
				resolve
			};
		});
	}

	function handleBackdropMouseDown(event: MouseEvent) {
		if (confirmDialog) return;
		if (event.target !== event.currentTarget) return;
		if (hasOpenNestedPopover()) return;
		closeModal();
	}

	function hasOpenNestedPopover(): boolean {
		return Boolean(
			modalEl?.querySelector('.colorPickerPopover, .datePickerMenu.open, .pickerMenu.open')
		);
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			if (confirmDialog) {
				event.preventDefault();
				closeConfirmDialog(confirmDialog.cancelOptionId);
				return;
			}
			closeModal();
		}
	}

	function chartRoleSuffix(membership: ChartMembership): string {
		const accessRoleLabel = membership.AccessRoleLabel ?? membership.RoleName;
		if (accessRoleLabel === 'Bootstrap') return ' (Bootstrap)';
		return accessRoleLabel === 'Manager'
			? ' (Manager)'
			: accessRoleLabel === 'Maintainer'
				? ' (Maintainer)'
				: '';
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	function updateCustomScrollbar() {
		if (!modalScrollEl) return;

		const scrollHeight = modalScrollEl.scrollHeight;
		const clientHeight = modalScrollEl.clientHeight;
		const scrollTop = modalScrollEl.scrollTop;
		const hasOverflow = scrollHeight > clientHeight + 1;

		showCustomScrollbar = hasOverflow;
		if (!hasOverflow) {
			thumbHeightPx = 0;
			thumbTopPx = 0;
			return;
		}

		const railHeight = railEl?.clientHeight ?? Math.max(clientHeight - 24, 0);
		if (railHeight <= 0) return;

		const minThumbHeight = 36;
		const nextThumbHeight = Math.max(minThumbHeight, (railHeight * clientHeight) / scrollHeight);
		const maxThumbTop = Math.max(railHeight - nextThumbHeight, 0);
		const maxScrollTop = Math.max(scrollHeight - clientHeight, 1);
		const nextThumbTop = (scrollTop / maxScrollTop) * maxThumbTop;

		thumbHeightPx = nextThumbHeight;
		thumbTopPx = clamp(nextThumbTop, 0, maxThumbTop);
	}

	function onModalScroll() {
		if (!isDraggingScrollbar) {
			updateCustomScrollbar();
		}
	}

	function onDragMove(event: MouseEvent) {
		if (!isDraggingScrollbar || !modalScrollEl || !railEl) return;

		const railHeight = railEl.clientHeight;
		const maxThumbTop = Math.max(railHeight - thumbHeightPx, 0);
		const nextThumbTop = clamp(dragStartThumbTopPx + (event.clientY - dragStartY), 0, maxThumbTop);
		const maxScrollTop = Math.max(modalScrollEl.scrollHeight - modalScrollEl.clientHeight, 0);

		thumbTopPx = nextThumbTop;
		modalScrollEl.scrollTop = maxThumbTop > 0 ? (nextThumbTop / maxThumbTop) * maxScrollTop : 0;
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

	function stopDragging() {
		if (isDraggingScrollbar) {
			setGlobalScrollbarDragging(false);
		}
		isDraggingScrollbar = false;
		if (typeof window !== 'undefined') {
			window.removeEventListener('mousemove', onDragMove);
			window.removeEventListener('mouseup', stopDragging);
		}
	}

	function startThumbDrag(event: MouseEvent) {
		if (!showCustomScrollbar) return;
		event.preventDefault();
		event.stopPropagation();
		isDraggingScrollbar = true;
		setGlobalScrollbarDragging(true);
		dragStartY = event.clientY;
		dragStartThumbTopPx = thumbTopPx;
		window.addEventListener('mousemove', onDragMove);
		window.addEventListener('mouseup', stopDragging);
	}

	function handleRailClick(event: MouseEvent) {
		if (!modalScrollEl || !railEl || !showCustomScrollbar) return;
		if (event.target !== railEl) return;

		const rect = railEl.getBoundingClientRect();
		const desiredTop = clamp(
			event.clientY - rect.top - thumbHeightPx / 2,
			0,
			Math.max(rect.height - thumbHeightPx, 0)
		);
		const maxThumbTop = Math.max(rect.height - thumbHeightPx, 1);
		const maxScrollTop = Math.max(modalScrollEl.scrollHeight - modalScrollEl.clientHeight, 0);
		modalScrollEl.scrollTop = (desiredTop / maxThumbTop) * maxScrollTop;
		updateCustomScrollbar();
	}

	function handleSelectChart(chartId: number) {
		selectedChartId = chartId;
		showCreateChartForm = false;
		actionError = '';
	}

	function openCreateChartForm() {
		if (isCreatingChart) return;
		selectedChartId = null;
		showCreateChartForm = true;
		newChartName = '';
		actionError = '';
		managerDraftStatusMessage = '';
		if (typeof document !== 'undefined') {
			const activeEl = document.activeElement;
			if (activeEl instanceof HTMLElement) {
				activeEl.blur();
			}
		}
	}

	async function handleCreateChart() {
		if (isCreatingChart) return;
		const chartName = newChartName.trim();
		if (!chartName) return;

		isCreatingChart = true;
		actionError = '';

		try {
			const response = await fetchWithAuthRedirect(`${base}/api/charts`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ chartName })
			});
			if (!response) return;
			if (!response.ok) {
				const message = await parseErrorMessage(
					response,
					`Failed to create chart (${response.status})`
				);
				throw new Error(message);
			}

			const data = (await response.json()) as { chartId?: number | null };
			await refreshMemberships();
			const newChartId = normalizeChartId(data.chartId);
			if (newChartId !== null) {
				currentChartId = newChartId;
				selectedChartId = newChartId;
				showCreateChartForm = false;
				newChartName = '';
			}
			await goto(`${base}/`, { invalidateAll: true });
		} catch (errorValue) {
			actionError = errorValue instanceof Error ? errorValue.message : 'Failed to create chart';
		} finally {
			isCreatingChart = false;
		}
	}

	async function refreshMemberships() {
		membershipsLoading = true;
		membershipsError = '';

		try {
			const response = await fetchWithAuthRedirect(`${base}/api/charts/memberships`, {
				headers: { accept: 'application/json' }
			});
			if (!response) {
				throw new Error('Session expired or access changed. Sign in again and retry.');
			}

			if (!response.ok) {
				const message = await parseErrorMessage(
					response,
					`Failed to refresh chart list (${response.status})`
				);
				throw new Error(message);
			}

			const data = (await response.json()) as {
				activeChartId?: number | null;
				memberships?: ChartMembership[];
			};
			liveMemberships = Array.isArray(data.memberships)
				? data.memberships.map((membership) => ({
						...membership,
						ChartId: Number(membership.ChartId),
						IsActive: Boolean(membership.IsActive),
						ThemeJson: typeof membership.ThemeJson === 'string' ? membership.ThemeJson : null,
						VersionAt: typeof membership.VersionAt === 'string' ? membership.VersionAt : null
					}))
				: [];
			currentChartId = normalizeChartId(data.activeChartId) ?? currentChartId;
			if (syncSelectionToCurrentOnRefresh) {
				selectedChartId =
					currentChartId ??
					(liveMemberships.length > 0 ? liveMemberships[0].ChartId : selectedChartId);
				syncSelectionToCurrentOnRefresh = false;
			}
			await onMembershipsRefresh(liveMemberships, currentChartId);
			hasLiveMemberships = true;
		} catch (errorValue) {
			membershipsError =
				errorValue instanceof Error ? errorValue.message : 'Failed to refresh chart list';
		} finally {
			membershipsLoading = false;
		}
	}

	async function handleMakeDefault() {
		if (!selectedMembership || selectedMembership.IsDefault || isSavingDefault) return;
		isSavingDefault = true;
		actionError = '';

		try {
			const response = await fetchWithAuthRedirect(`${base}/api/charts/default`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ chartId: selectedMembership.ChartId })
			});
			if (!response) return;
			if (!response.ok) {
				const message = await parseErrorMessage(
					response,
					`Failed to save default chart (${response.status})`
				);
				throw new Error(message);
			}
			await refreshMemberships();
		} catch (errorValue) {
			actionError =
				errorValue instanceof Error ? errorValue.message : 'Failed to save default chart';
		} finally {
			isSavingDefault = false;
		}
	}

	async function handleViewChart() {
		if (
			!selectedMembership ||
			selectedMembership.ChartId === resolvedCurrentChartId ||
			isSwitchingChart
		)
			return;
		isSwitchingChart = true;
		actionError = '';

		try {
			const response = await fetchWithAuthRedirect(`${base}/api/charts/active`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ chartId: selectedMembership.ChartId })
			});
			if (!response) return;
			if (!response.ok) {
				const message = await parseErrorMessage(
					response,
					`Failed to switch chart (${response.status})`
				);
				throw new Error(message);
			}
			currentChartId = selectedMembership.ChartId;
			await goto(`${base}/`, { invalidateAll: true });
		} catch (errorValue) {
			actionError = errorValue instanceof Error ? errorValue.message : 'Failed to switch chart';
		} finally {
			isSwitchingChart = false;
		}
	}

	$: if (typeof document !== 'undefined') {
		document.body.classList.toggle('team-modal-open', open);
	}

	$: effectiveMemberships = hasLiveMemberships
		? liveMemberships
		: open && membershipsLoading
			? []
			: chartMemberships;

	$: resolvedCurrentChartId =
		currentChartId ??
		normalizeChartId(activeChartId) ??
		(effectiveMemberships.length === 1 ? effectiveMemberships[0].ChartId : null);

	$: selectedMembership =
		(selectedChartId === null
			? null
			: effectiveMemberships.find((membership) => membership.ChartId === selectedChartId)) ??
		null;

	$: isSelectedMembershipActive =
		selectedMembership !== null && selectedMembership.ChartId === resolvedCurrentChartId;

	$: canCreateCharts = effectiveMemberships.some(
		(membership) => membership.RoleName === 'Manager'
	);

	$: if (selectedMembership && selectedMembership.RoleName === 'Manager') {
		ensureManagerState(selectedMembership);
	}

	$: selectedManagerSaved =
		selectedMembership && selectedMembership.RoleName === 'Manager'
			? (managerSavedByChartId[selectedMembership.ChartId] ?? null)
			: null;

	$: selectedManagerDraft =
		selectedMembership && selectedMembership.RoleName === 'Manager'
			? (managerDraftByChartId[selectedMembership.ChartId] ?? null)
			: null;

	$: if (
		selectedMembership &&
		selectedMembership.RoleName === 'Manager' &&
		!isTogglingChartState
	) {
		const chartId = selectedMembership.ChartId;
		const nextIsActive = selectedMembership.IsActive;
		const nextVersionAt =
			typeof selectedMembership.VersionAt === 'string' ? selectedMembership.VersionAt : null;
		const savedState = managerSavedByChartId[chartId];
		if (
			savedState &&
			(savedState.isActive !== nextIsActive || savedState.versionAt !== nextVersionAt)
		) {
			managerSavedByChartId = {
				...managerSavedByChartId,
				[chartId]: {
					...savedState,
					isActive: nextIsActive,
					versionAt: nextVersionAt
				}
			};
		}
		const draftState = managerDraftByChartId[chartId];
		if (
			draftState &&
			(draftState.isActive !== nextIsActive || draftState.versionAt !== nextVersionAt)
		) {
			managerDraftByChartId = {
				...managerDraftByChartId,
				[chartId]: {
					...draftState,
					isActive: nextIsActive,
					versionAt: nextVersionAt
				}
			};
		}
	}

	$: hasManagerThemeChanges =
		selectedManagerSaved && selectedManagerDraft
			? !areThemeDraftsEqual(selectedManagerSaved.themes.dark, selectedManagerDraft.themes.dark) ||
				!areThemeDraftsEqual(selectedManagerSaved.themes.light, selectedManagerDraft.themes.light)
			: false;

	$: areAllThemeFieldsAtDefaults =
		selectedManagerDraft !== null
			? areThemeDraftsEqual(selectedManagerDraft.themes.dark, themeDefaults.dark) &&
				areThemeDraftsEqual(selectedManagerDraft.themes.light, themeDefaults.light)
			: true;

	$: hasManagerDraftChanges =
		selectedManagerSaved && selectedManagerDraft
			? resolveChartNameForSave(
					selectedManagerDraft.chartName,
					selectedManagerSaved.chartName
				) !== selectedManagerSaved.chartName || hasManagerThemeChanges
			: false;
	$: isBootstrapOnlySelectedManager =
		selectedMembership?.RoleName === 'Manager' &&
		(selectedMembership.AccessRoleLabel ?? selectedMembership.RoleName) === 'Bootstrap';

	$: {
		const currentManagerSelectionId =
			selectedMembership && selectedMembership.RoleName === 'Manager'
				? selectedMembership.ChartId
				: null;
		if (
			currentManagerSelectionId !== null &&
			currentManagerSelectionId !== lastManagerSelectionId
		) {
			managerDraftStatusMessage = '';
			selectedThemeMode = currentThemeMode;
			selectedThemeSection = 'page';
			managerThemesExpanded = false;
			lastManagerSelectionId = currentManagerSelectionId;
		}
	}

	$: if (open && !wasOpen) {
		hasLiveMemberships = false;
		liveMemberships = [];
		currentChartId = normalizeChartId(activeChartId);
		selectedChartId = normalizeChartId(activeChartId);
		selectedThemeMode = currentThemeMode;
		selectedThemeSection = 'page';
		managerThemesExpanded = false;
		lastManagerSelectionId = null;
		showCreateChartForm = false;
		newChartName = '';
		syncSelectionToCurrentOnRefresh = true;
		actionError = '';
		membershipsError = '';
		managerDraftStatusMessage = '';
		void refreshMemberships();
	}

	$: if (open && selectedThemeMode !== currentThemeMode) {
		selectedThemeMode = currentThemeMode;
	}

	$: if (open && selectedMembership) {
		if (
			selectedMembership.RoleName === 'Manager' &&
			selectedManagerDraft &&
			isSelectedMembershipActive
		) {
			applyThemeState(selectedManagerDraft);
		} else {
			applyActiveChartThemeOrDefault();
		}
	}

	$: if (open && !showCreateChartForm && !selectedChartId && effectiveMemberships.length > 0) {
		selectedChartId = resolvedCurrentChartId ?? effectiveMemberships[0].ChartId;
	}

	$: if (
		open &&
		selectedChartId !== null &&
		effectiveMemberships.length > 0 &&
		!effectiveMemberships.some((membership) => membership.ChartId === selectedChartId)
	) {
		selectedChartId = resolvedCurrentChartId ?? effectiveMemberships[0].ChartId;
	}

	$: wasOpen = open;

	$: if (!open) {
		syncSelectionToCurrentOnRefresh = false;
		stopDragging();
		applyActiveChartThemeOrDefault();
		managerDraftStatusMessage = '';
	}

	$: modalScrollSyncKey = open
		? [
				effectiveMemberships.length,
				selectedChartId ?? '',
				showCreateChartForm ? '1' : '0',
				selectedThemeMode,
				selectedThemeSection,
				actionError,
				managerDraftStatusMessage,
				membershipsLoading ? '1' : '0',
				membershipsError
			].join('|')
		: '';

	$: if (open && modalScrollSyncKey) {
		tick().then(() => {
			updateCustomScrollbar();
			requestAnimationFrame(updateCustomScrollbar);
		});
	}

	onDestroy(() => {
		if (confirmDialog) {
			closeConfirmDialog(confirmDialog.cancelOptionId);
		}
		stopDragging();
		if (typeof document !== 'undefined') {
			document.body.classList.remove('team-modal-open');
			if (!document.body.dataset.scrollbarDragCount) {
				document.body.classList.remove('scrollbar-dragging');
			}
		}
	});

	onMount(() => {
		const onResize = () => {
			updateCustomScrollbar();
		};
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('resize', onResize);
		};
	});
</script>

<svelte:window on:keydown={handleWindowKeydown} />

{#if open}
	<div class="teamSetupBackdrop" role="presentation" on:mousedown={handleBackdropMouseDown}>
		<div
			class="teamSetupModal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="chart-setup-title"
			bind:this={modalEl}
		>
			<div class="teamSetupModalScroll" bind:this={modalScrollEl} on:scroll={onModalScroll}>
				<header class="teamSetupHeader">
					<div>
						<h2 id="chart-setup-title">Charts</h2>
					</div>
					<button class="btn" type="button" on:click={closeModal}>Close</button>
				</header>

				<div class="teamSetupBody">
					<nav class="teamSetupNav" aria-label="Charts">
						{#if membershipsLoading && effectiveMemberships.length === 0}
							<div class="teamSetupNavBtn">Loading charts...</div>
						{:else if effectiveMemberships.length === 0}
							<div class="teamSetupNavBtn">No charts found.</div>
						{:else}
							{#each effectiveMemberships as membership (membership.ChartId)}
								<button
									type="button"
									class={`teamSetupNavBtn${membership.ChartId === selectedChartId ? ' active' : ''}`}
									aria-current={membership.ChartId === selectedChartId ? 'page' : undefined}
									on:click={() => handleSelectChart(membership.ChartId)}
								>
									{displayChartName(membership)}{chartRoleSuffix(membership)}
								</button>
							{/each}
						{/if}
						{#if canCreateCharts}
							<button
								type="button"
								class={`teamSetupNavCreateBtn${showCreateChartForm ? ' active' : ''}`}
								on:click={openCreateChartForm}
								disabled={isCreatingChart}
								aria-label="Create a new chart"
								title="Create a new chart"
							>
								<svg viewBox="0 0 24 24" aria-hidden="true">
									<path d="M12 5v14M5 12h14" />
								</svg>
							</button>
						{/if}
					</nav>

					<div class="teamSetupPanel">
						<section class="setupSection">
							{#if membershipsError}
								<p class="setupActionAlert" role="alert">{membershipsError}</p>
							{/if}
							{#if showCreateChartForm}
								<div class="setupCard managerCustomizationCard">
									<form
										class="setupGrid managerCustomizationGrid"
										on:submit|preventDefault={handleCreateChart}
									>
										<label class="setupField">
											<span class="setupFieldLabel">Chart Name</span>
											<input
												class="input"
												type="text"
												maxlength="120"
												bind:value={newChartName}
												placeholder="Chart name"
											/>
										</label>
										<button
											class="btn primary managerCreateChartBtn"
											type="submit"
											disabled={isCreatingChart || !newChartName.trim()}
										>
											{isCreatingChart ? 'Creating...' : 'Create'}
										</button>
									</form>
								</div>
							{:else if !selectedMembership}
								<p class="setupCardHint">Select a chart to view options.</p>
							{:else}
								<div class="setupGrid">
									{#if selectedMembership.IsDefault}
										<div class="readOnlyField">
											<span>Default Chart</span>
										</div>
									{:else}
										<button
											type="button"
											class="btn primary readOnlyFieldActionBtn"
											on:click={handleMakeDefault}
											disabled={isSavingDefault}
										>
											{isSavingDefault ? 'Saving...' : 'Make Default'}
										</button>
									{/if}

									{#if isSelectedMembershipActive}
										<div class="readOnlyField">
											<span>Active Chart</span>
										</div>
									{:else}
										<button
											type="button"
											class="btn primary readOnlyFieldActionBtn"
											on:click={handleViewChart}
											disabled={isSwitchingChart}
										>
											{isSwitchingChart ? 'Switching...' : 'View'}
										</button>
									{/if}
								</div>

								{#if selectedMembership.RoleName === 'Manager' && selectedManagerDraft}
									<div class="setupCard managerCustomizationCard">
										<div class="setupGrid managerCustomizationGrid">
											<label class="setupField">
												<span class="setupFieldLabel">Chart Name</span>
												<input
													class="input"
													type="text"
													maxlength="120"
													value={selectedManagerDraft.chartName}
													on:input={handleManagerNameInput}
													placeholder="Chart name"
												/>
											</label>
											<button
												class={`btn managerChartToggleBtn ${selectedManagerDraft.isActive ? 'managerChartToggleBtnDanger' : 'managerChartToggleBtnSuccess'}`}
												type="button"
												on:click={toggleManagerChartActive}
												disabled={
													isTogglingChartState ||
													(selectedManagerDraft.isActive && isBootstrapOnlySelectedManager)
												}
												title={
													selectedManagerDraft.isActive && isBootstrapOnlySelectedManager
														? 'Bootstrap-only access cannot deactivate this chart.'
														: undefined
												}
											>
												{isTogglingChartState
													? 'Saving...'
													: selectedManagerDraft.isActive
														? 'Deactivate'
														: 'Activate'}
											</button>
										</div>
										{#if isSelectedMembershipActive}
											<div class="managerThemesSection">
												<div class="managerThemesContainer" class:expanded={managerThemesExpanded}>
													<button
														type="button"
														class="btn managerThemesCollapseBtn"
														on:click={toggleManagerThemesExpanded}
														aria-expanded={managerThemesExpanded}
													>
														<span>Themes</span>
														<span class="managerThemesChevron" aria-hidden="true">
															{managerThemesExpanded ? '▾' : '▸'}
														</span>
													</button>
													{#if managerThemesExpanded}
														<div class="managerThemesContent">
															<div
																class="managerThemeSectionSwitch"
																role="tablist"
																aria-label="Theme section"
															>
																<ThemeToggle
																	theme={selectedThemeMode}
																	onToggle={toggleSelectedThemeMode}
																/>
																<button
																	type="button"
																	role="tab"
																	class={`actionBtn btn${selectedThemeSection === 'page' ? ' primary' : ''}`}
																	aria-selected={selectedThemeSection === 'page'}
																	on:click={() => (selectedThemeSection = 'page')}
																>
																	Page
																</button>
																<button
																	type="button"
																	role="tab"
																	class={`actionBtn btn${selectedThemeSection === 'canvas' ? ' primary' : ''}`}
																	aria-selected={selectedThemeSection === 'canvas'}
																	on:click={() => (selectedThemeSection = 'canvas')}
																>
																	Canvas
																</button>
																<div class="managerThemeQuickActions">
																	<button
																		type="button"
																		class="btn actionBtn managerThemeDefaultBtn"
																		on:click={handleManagerResetDefaults}
																		disabled={areAllThemeFieldsAtDefaults || isSavingManagerDraft}
																		title={areAllThemeFieldsAtDefaults
																			? 'Already using default theme'
																			: 'Reset theme colors to default values'}
																	>
																		Default
																	</button>
																	<button
																		type="button"
																		class="btn actionBtn managerThemeRevertBtn"
																		class:dirty={hasManagerThemeChanges}
																		on:click={handleManagerThemeRestoreSaved}
																		disabled={!hasManagerThemeChanges || isSavingManagerDraft}
																		title={hasManagerThemeChanges
																			? 'Revert theme colors to last saved values'
																			: 'No theme color changes have been made'}
																	>
																		Revert
																	</button>
																</div>
															</div>

															<div class="managerThemeTableWrap">
																<HorizontalScrollArea>
																	<table class="managerThemeTable">
																		<thead>
																			<tr>
																				<th scope="col">Setting</th>
																				<th scope="col">Color</th>
																				<th scope="col">Setting</th>
																				<th scope="col">Color</th>
																			</tr>
																		</thead>
																		<tbody>
																			{#each activeThemeFieldRows as themeRow}
																				<tr>
																					<th scope="row">{themeRow[0].label}</th>
																					<td class="managerThemeColorCell">
																						<div class="managerThemeField">
																							<ColorPicker
																								id={`manager-theme-${themeRow[0].key}`}
																								label={themeRow[0].label}
																								value={selectedManagerDraft.themes[selectedThemeMode][
																									themeRow[0].key
																								]}
																								on:change={(event) =>
																									handleManagerThemeInput(
																										themeRow[0].key,
																										event.detail
																									)}
																							/>
																						</div>
																					</td>
																					{#if themeRow[1]}
																						<th scope="row" class="managerThemeSettingDivider">
																							{themeRow[1].label}
																						</th>
																						<td class="managerThemeColorCell">
																							<div class="managerThemeField">
																								<ColorPicker
																									id={`manager-theme-${themeRow[1].key}`}
																									label={themeRow[1].label}
																									value={selectedManagerDraft.themes[selectedThemeMode][
																										themeRow[1].key
																									]}
																									on:change={(event) =>
																										handleManagerThemeInput(
																											themeRow[1].key,
																											event.detail
																										)}
																								/>
																							</div>
																						</td>
																					{:else}
																						<td colspan="2"></td>
																					{/if}
																				</tr>
																			{/each}
																		</tbody>
																	</table>
																</HorizontalScrollArea>
															</div>
														</div>
													{/if}
												</div>
											</div>
										{:else}
											<p class="setupCardHint">
												Switch to this chart to edit its theme settings.
											</p>
										{/if}

										<div class="setupActions managerCustomizationActions">
											<button
												class="btn primary managerSaveBtn"
												type="button"
												on:click={handleManagerSaveDraft}
												disabled={!hasManagerDraftChanges || isSavingManagerDraft}
												title={hasManagerDraftChanges
													? 'Save chart changes'
													: 'No changes have been made.'}
											>
												{isSavingManagerDraft ? 'Saving...' : 'Save'}
											</button>
										</div>

										{#if managerDraftStatusMessage}
											<p
												class={`managerStatusMessage managerStatusMessage${
													managerDraftStatusTone === 'success'
														? 'Success'
														: managerDraftStatusTone === 'error'
															? 'Error'
															: 'Info'
												}`}
												role={managerDraftStatusTone === 'error' ? 'alert' : 'status'}
											>
												{managerDraftStatusMessage}
											</p>
										{/if}
									</div>
								{/if}
							{/if}
							{#if actionError}
								<p class="setupActionAlert" role="alert">{actionError}</p>
							{/if}
						</section>
					</div>
				</div>
			</div>
			{#if showCustomScrollbar}
				<div
					class="teamSetupScrollRail"
					role="presentation"
					aria-hidden="true"
					bind:this={railEl}
					on:mousedown={handleRailClick}
				>
					<div
						class="teamSetupScrollThumb"
						class:dragging={isDraggingScrollbar}
						role="presentation"
						style={`height:${thumbHeightPx}px;transform:translateY(${thumbTopPx}px);`}
						on:mousedown={startThumbDrag}
					></div>
				</div>
			{/if}
		</div>
		<ConfirmDialog
			open={Boolean(confirmDialog)}
			title={confirmDialog?.title ?? ''}
			message={confirmDialog?.message ?? ''}
			options={confirmDialog?.options ?? []}
			cancelOptionId={confirmDialog?.cancelOptionId ?? 'cancel'}
			on:select={(event) => closeConfirmDialog(event.detail)}
		/>
	</div>
{/if}
