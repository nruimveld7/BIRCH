<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import HierarchiesModal from '$lib/components/HierarchiesModal.svelte';
	import HierarchyToolsModal from '$lib/components/HierarchyToolsModal.svelte';
	import OnboardingTourModal from '$lib/components/OnboardingTourModal.svelte';
	import { fetchWithAuthRedirect } from '$lib/utils/fetchWithAuthRedirect';

	type Theme = 'light' | 'dark';
	type ThemePreference = 'system' | 'dark' | 'light';
	type HierarchyRole = 'Member' | 'Maintainer' | 'Manager';
	type HierarchyMembership = {
		HierarchyId: number;
		Name: string;
		RoleName: HierarchyRole;
		IsDefault: boolean;
		IsActive: boolean;
		PlaceholderThemeJson?: string | null;
		VersionAt?: string | Date | null;
	};
	type OnboardingSlide = {
		id: string;
		role: HierarchyRole;
		roleTier: number;
		title: string;
		description: string;
		imageUrl: string | null;
	};

	export let data: {
		hierarchy: { HierarchyId: number; Name: string } | null;
		userRole: HierarchyRole | null;
		hierarchyMemberships: HierarchyMembership[];
		currentUserOid: string | null;
		onboarding: {
			currentTier: number;
			targetTier: number;
			slides: OnboardingSlide[];
		};
	};

	let hierarchy = data.hierarchy;
	let userRole = data.userRole;
	let hierarchyMemberships = data.hierarchyMemberships;
	let scheduleMemberships: Array<{
		ScheduleId: number;
		Name: string;
		RoleName: HierarchyRole;
		IsDefault: boolean;
		IsActive: boolean;
		ThemeJson?: string | null;
		VersionAt?: string | Date | null;
	}> = [];
	let showHierarchiesModal = false;
	let showToolsModal = false;

	let theme: Theme = 'dark';
	let themePreferenceState: ThemePreference = 'system';
	let systemTheme: Theme = 'dark';
	let mediaQuery: MediaQueryList | null = null;

	let onboardingOpen = false;
	let onboardingSlideIndex = 0;
	let onboardingDontShowAgain = false;
	let onboardingSaving = false;
	let onboardingSaveError = '';
	let onboardingDismissedForSession = false;
	let onboardingSlidesForModal: OnboardingSlide[] = data.onboarding.slides;
	let onboardingTargetTierForModal = data.onboarding.targetTier;
	let onboardingCurrentTierState = data.onboarding.currentTier;

	const canOpenTools = () => userRole === 'Maintainer' || userRole === 'Manager';
	const canAssignManagerRole = () => userRole === 'Manager';
	const canOpenHierarchySetup = () => canAssignManagerRole() || hierarchyMemberships.length > 1;

	function resolveTheme(preference: ThemePreference): Theme {
		if (preference === 'light' || preference === 'dark') return preference;
		return systemTheme;
	}

	function applyTheme(nextTheme: Theme) {
		if (typeof document === 'undefined') return;
		document.documentElement.setAttribute('data-theme', nextTheme);
	}

	function loadThemePreference(): ThemePreference {
		if (typeof localStorage === 'undefined') return 'system';
		const saved = localStorage.getItem('birch.themePreference');
		return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
	}

	function persistThemePreference(preference: ThemePreference) {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem('birch.themePreference', preference);
	}

	function toggleTheme() {
		themePreferenceState =
			themePreferenceState === 'system'
				? 'dark'
				: themePreferenceState === 'dark'
					? 'light'
					: 'system';
		persistThemePreference(themePreferenceState);
		theme = resolveTheme(themePreferenceState);
		applyTheme(theme);
	}

	$: scheduleMemberships = hierarchyMemberships.map((membership) => ({
		ScheduleId: membership.HierarchyId,
		Name: membership.Name,
		RoleName: membership.RoleName,
		IsDefault: membership.IsDefault,
		IsActive: membership.IsActive,
		ThemeJson: membership.PlaceholderThemeJson ?? null,
		VersionAt: membership.VersionAt ?? null
	}));

	async function refreshMemberships() {
		const res = await fetchWithAuthRedirect(`${base}/api/hierarchies/memberships`, {}, base);
		if (!res || !res.ok) return;
		const payload = await res.json();
		hierarchyMemberships = payload.memberships ?? [];
		const resolvedActiveId = payload.activeHierarchyId as number | null;
		const activeMembership =
			hierarchyMemberships.find((membership) => membership.HierarchyId === resolvedActiveId) ??
			hierarchyMemberships[0] ??
			null;
		hierarchy = activeMembership
			? { HierarchyId: activeMembership.HierarchyId, Name: activeMembership.Name }
			: null;
		userRole = activeMembership?.RoleName ?? null;
	}

	async function saveOnboardingProgress() {
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
			onboardingCurrentTierState = Math.max(onboardingCurrentTierState, onboardingTargetTierForModal);
			return true;
		} catch {
			onboardingSaveError = 'Unable to save onboarding progress. Please try again.';
			return false;
		} finally {
			onboardingSaving = false;
		}
	}

	async function openOnboardingFromHelp() {
		if (onboardingSaving) return;
		onboardingSaveError = '';
		try {
			const response = await fetchWithAuthRedirect(`${base}/api/onboarding/slides`, {}, base);
			if (!response || !response.ok) {
				onboardingSaveError = 'Unable to load onboarding steps. Please try again.';
				return;
			}
			const payload = await response.json();
			const fetchedSlides = Array.isArray(payload?.slides) ? (payload.slides as OnboardingSlide[]) : [];
			onboardingSlidesForModal = fetchedSlides;
			onboardingTargetTierForModal =
				typeof payload?.targetTier === 'number' ? payload.targetTier : data.onboarding.targetTier;
			onboardingSlideIndex = 0;
			onboardingDontShowAgain = false;
			onboardingDismissedForSession = false;
			onboardingOpen = onboardingSlidesForModal.length > 0;
		} catch {
			onboardingSaveError = 'Unable to load onboarding steps. Please try again.';
		}
	}

	async function handleOnboardingClose(markComplete: boolean) {
		if (markComplete) {
			const saved = await saveOnboardingProgress();
			if (!saved) return;
		}
		onboardingOpen = false;
		onboardingDismissedForSession = true;
		onboardingDontShowAgain = false;
	}

	async function handleOnboardingComplete() {
		const saved = await saveOnboardingProgress();
		if (!saved) return;
		onboardingOpen = false;
		onboardingDismissedForSession = true;
		onboardingDontShowAgain = false;
	}

	onMount(() => {
		void refreshMemberships();
		document.body.classList.add('app-shell-route');
		systemTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
		themePreferenceState = loadThemePreference();
		theme = resolveTheme(themePreferenceState);
		applyTheme(theme);
		mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
		const onMediaThemeChange = (event: MediaQueryListEvent) => {
			systemTheme = event.matches ? 'light' : 'dark';
			if (themePreferenceState === 'system') {
				theme = systemTheme;
				applyTheme(theme);
			}
		};
		mediaQuery.addEventListener('change', onMediaThemeChange);

		if (data.onboarding.slides.length > 0 && !onboardingDismissedForSession) {
			onboardingSlidesForModal = data.onboarding.slides;
			onboardingTargetTierForModal = data.onboarding.targetTier;
			onboardingOpen = true;
		}

		return () => {
			mediaQuery?.removeEventListener('change', onMediaThemeChange);
		};
	});

	onDestroy(() => {
		if (typeof document !== 'undefined') {
			document.body.classList.remove('app-shell-route');
		}
	});
</script>

<div class="app">
	<div class="card">
		<div class="cardScroll">
			<div class="topbar">
				<div class="topbarTitleSlot">
					{#if canOpenHierarchySetup()}
						<button
							type="button"
							class="title titleButton"
							on:click={() => (showHierarchiesModal = true)}
							aria-label="Open hierarchy setup"
						>
							{hierarchy?.Name ?? 'No Hierarchy Selected'}
						</button>
					{:else}
						<div class="title">{hierarchy?.Name ?? 'No Hierarchy Selected'}</div>
					{/if}
				</div>
				<div class="topbarCenter"></div>
				<div class="topbarActions">
					{#if canOpenTools()}
						<button type="button" class="actionBtn" on:click={() => (showToolsModal = true)}>
							Hierarchy Tools
						</button>
					{/if}
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

			<div class="scheduleViewport"></div>
		</div>
	</div>
</div>

<HierarchiesModal
	open={showHierarchiesModal}
	activeScheduleId={hierarchy?.HierarchyId ?? null}
	{scheduleMemberships}
	currentThemeMode={theme}
	onThemeModeChange={(nextMode) => {
		themePreferenceState = nextMode;
		theme = nextMode;
		applyTheme(theme);
		persistThemePreference(themePreferenceState);
	}}
	onClose={() => (showHierarchiesModal = false)}
	onMembershipsRefresh={async () => {
		await refreshMemberships();
	}}
/>

<HierarchyToolsModal
	open={showToolsModal}
	canAssignManagerRole={canAssignManagerRole()}
	currentUserOid={data.currentUserOid ?? ''}
	onClose={() => (showToolsModal = false)}
	onScheduleRefresh={async () => {
		await refreshMemberships();
	}}
/>

<OnboardingTourModal
	open={onboardingOpen}
	slides={onboardingSlidesForModal}
	currentIndex={onboardingSlideIndex}
	dontShowAgain={onboardingDontShowAgain}
	isSaving={onboardingSaving}
	errorMessage={onboardingSaveError}
	on:indexChange={(event) => (onboardingSlideIndex = event.detail)}
	on:dontShowAgainChange={(event) => (onboardingDontShowAgain = event.detail)}
	on:close={(event) => handleOnboardingClose(event.detail.markComplete)}
	on:complete={handleOnboardingComplete}
/>

<style>
	.actionBtn {
		appearance: none;
		border: 1px solid var(--interactive-border);
		border-radius: 999px;
		background: var(--interactive-bg);
		color: var(--text);
		padding: 8px 12px;
		font-size: 13px;
		font-weight: 760;
		cursor: pointer;
	}
	.actionBtn:hover {
		background: var(--interactive-bg-hover);
		border-color: var(--interactive-border-hover);
	}
	.topbarCenter {
		flex: 1;
	}
	.scheduleViewport {
		min-height: 0;
		flex: 1;
	}
</style>
