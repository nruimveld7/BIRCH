<script lang="ts">
	import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
	import ThemedCheckbox from '$lib/components/ThemedCheckbox.svelte';

	export type ScheduleRole = 'Member' | 'Maintainer' | 'Manager';
	export type OnboardingSlide = {
		id: string;
		role: ScheduleRole;
		roleTier: number;
		title: string;
		description: string;
		imageUrl: string | null;
	};

	export let open = false;
	export let slides: OnboardingSlide[] = [];
	export let currentIndex = 0;
	export let dontShowAgain = false;
	export let isSaving = false;
	export let errorMessage = '';

	const dispatch = createEventDispatcher<{
		close: { markComplete: boolean };
		indexChange: number;
		dontShowAgainChange: boolean;
		complete: void;
	}>();

	$: totalSlides = slides.length;
	$: safeIndex = totalSlides === 0 ? 0 : Math.max(0, Math.min(currentIndex, totalSlides - 1));
	$: activeSlide = totalSlides === 0 ? null : slides[safeIndex];
	$: canGoPrevious = safeIndex > 0;
	$: canGoNext = totalSlides > 0 && safeIndex < totalSlides - 1;
	$: progressLabel = totalSlides > 0 ? `${safeIndex + 1} / ${totalSlides}` : '';

	let bodyScrollEl: HTMLDivElement | null = null;
	let railEl: HTMLDivElement | null = null;
	let showCustomScrollbar = false;
	let thumbHeightPx = 0;
	let thumbTopPx = 0;
	let isDraggingScrollbar = false;
	let dragStartY = 0;
	let dragStartThumbTopPx = 0;

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	function updateCustomScrollbar() {
		if (!bodyScrollEl) return;

		const scrollHeight = bodyScrollEl.scrollHeight;
		const clientHeight = bodyScrollEl.clientHeight;
		const scrollTop = bodyScrollEl.scrollTop;
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

	function onBodyScroll() {
		if (!isDraggingScrollbar) {
			updateCustomScrollbar();
		}
	}

	function onDragMove(event: MouseEvent) {
		if (!isDraggingScrollbar || !bodyScrollEl || !railEl) return;

		const railHeight = railEl.clientHeight;
		const maxThumbTop = Math.max(railHeight - thumbHeightPx, 0);
		const nextThumbTop = clamp(dragStartThumbTopPx + (event.clientY - dragStartY), 0, maxThumbTop);
		const maxScrollTop = Math.max(bodyScrollEl.scrollHeight - bodyScrollEl.clientHeight, 0);

		thumbTopPx = nextThumbTop;
		bodyScrollEl.scrollTop = maxThumbTop > 0 ? (nextThumbTop / maxThumbTop) * maxScrollTop : 0;
	}

	function stopDragging() {
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
		dragStartY = event.clientY;
		dragStartThumbTopPx = thumbTopPx;
		window.addEventListener('mousemove', onDragMove);
		window.addEventListener('mouseup', stopDragging);
	}

	function handleRailClick(event: MouseEvent) {
		if (!bodyScrollEl || !railEl || !showCustomScrollbar) return;
		if (event.target !== railEl) return;

		const rect = railEl.getBoundingClientRect();
		const desiredTop = clamp(
			event.clientY - rect.top - thumbHeightPx / 2,
			0,
			Math.max(rect.height - thumbHeightPx, 0)
		);
		const maxThumbTop = Math.max(rect.height - thumbHeightPx, 1);
		const maxScrollTop = Math.max(bodyScrollEl.scrollHeight - bodyScrollEl.clientHeight, 0);
		bodyScrollEl.scrollTop = (desiredTop / maxThumbTop) * maxScrollTop;
		updateCustomScrollbar();
	}

	function goPrevious() {
		if (!canGoPrevious || isSaving) return;
		dispatch('indexChange', safeIndex - 1);
	}

	function goNext() {
		if (!canGoNext || isSaving) return;
		dispatch('indexChange', safeIndex + 1);
	}

	function onDontShowAgainChange(event: CustomEvent<{ checked: boolean }>) {
		dispatch('dontShowAgainChange', event.detail.checked);
	}

	function closeModal() {
		if (isSaving) return;
		dispatch('close', { markComplete: dontShowAgain });
	}

	function completeTour() {
		if (isSaving) return;
		dispatch('complete');
	}

	function onBackdropMouseDown(event: MouseEvent) {
		if (event.target !== event.currentTarget) return;
		closeModal();
	}

	onMount(() => {
		const onResize = () => updateCustomScrollbar();
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('resize', onResize);
		};
	});

	onDestroy(() => {
		stopDragging();
	});

	$: if (open && activeSlide) {
		void tick().then(() => {
			updateCustomScrollbar();
			requestAnimationFrame(updateCustomScrollbar);
		});
	}
</script>

{#if open && activeSlide}
	<div class="onboardingLayer" role="presentation" on:mousedown={onBackdropMouseDown}>
		<div
			class="onboardingPanel"
			role="dialog"
			aria-modal="true"
			aria-labelledby="onboarding-title"
		>
			<header class="onboardingHeader">
				<p class="onboardingRoleLabel">{activeSlide.role} Tour</p>
				<h2 id="onboarding-title">{activeSlide.title}</h2>
				<p class="onboardingProgress">{progressLabel}</p>
			</header>
			<div class="onboardingBodyWrap">
				<div class="onboardingBody" bind:this={bodyScrollEl} on:scroll={onBodyScroll}>
					{#if activeSlide.imageUrl}
						<img
							class="onboardingImage"
							src={activeSlide.imageUrl}
							alt={activeSlide.title}
							loading="eager"
						/>
					{:else}
						<div class="onboardingImagePlaceholder">
							Add `image.png` to this onboarding step folder.
						</div>
					{/if}
					{#if activeSlide.description}
						<p class="onboardingDescription">{activeSlide.description}</p>
					{/if}
				</div>
				{#if showCustomScrollbar}
					<div
						class="onboardingScrollRail"
						role="presentation"
						aria-hidden="true"
						bind:this={railEl}
						on:mousedown={handleRailClick}
					>
						<div
							class="onboardingScrollThumb"
							class:dragging={isDraggingScrollbar}
							role="presentation"
							style={`height:${thumbHeightPx}px;transform:translateY(${thumbTopPx}px);`}
							on:mousedown={startThumbDrag}
						></div>
					</div>
				{/if}
			</div>
			<footer class="onboardingFooter">
				{#if errorMessage}
					<p class="onboardingError" role="alert">{errorMessage}</p>
				{/if}
				<div class="onboardingFooterLeft">
					<button type="button" class="finishBtn" on:click={closeModal} disabled={isSaving}>
						Close
					</button>
					<ThemedCheckbox
						id="onboarding-dont-show-again"
						checked={dontShowAgain}
						disabled={isSaving}
						label="Don't show this again"
						compact={true}
						on:change={onDontShowAgainChange}
					/>
				</div>
				<div class="onboardingActions">
					<button
						type="button"
						class="navBtn"
						on:click={goPrevious}
						disabled={!canGoPrevious || isSaving}
					>
						←
					</button>
					<button type="button" class="navBtn" on:click={goNext} disabled={!canGoNext || isSaving}>
						→
					</button>
					{#if !canGoNext}
						<button type="button" class="finishBtn" on:click={completeTour} disabled={isSaving}>
							{isSaving ? 'Saving...' : 'Finish'}
						</button>
					{/if}
				</div>
			</footer>
		</div>
	</div>
{/if}

<style>
	.onboardingLayer {
		position: fixed;
		inset: 0;
		z-index: 1200;
		display: grid;
		place-items: center;
		padding: 20px;
		background: var(--modal-backdrop);
		backdrop-filter: blur(4px);
	}

	.onboardingPanel {
		position: relative;
		width: min(920px, calc(100dvw - 32px));
		height: min(760px, calc(100dvh - 32px));
		border-radius: 16px;
		border: 1px solid var(--modal-border);
		background: var(--modal-surface);
		box-shadow: var(--shadow);
		display: grid;
		grid-template-rows: auto 1fr auto;
		overflow: hidden;
	}

	.onboardingHeader {
		padding: 18px 18px 12px;
		border-bottom: 1px solid var(--grid-2);
		display: grid;
		gap: 4px;
	}

	.onboardingRoleLabel {
		margin: 0;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.onboardingHeader h2 {
		margin: 0;
		font-size: 20px;
		line-height: 1.25;
		color: var(--text);
	}

	.onboardingProgress {
		margin: 0;
		font-size: 13px;
		color: var(--muted);
	}

	.onboardingBodyWrap {
		position: relative;
		min-height: 0;
	}

	.onboardingBody {
		height: 100%;
		padding: 16px 18px;
		overflow: auto;
		display: grid;
		gap: 12px;
		padding-right: calc(18px + var(--scrollbar-size) + 8px);
		scrollbar-width: none;
		-ms-overflow-style: none;
	}

	.onboardingBody::-webkit-scrollbar {
		width: 0;
		height: 0;
	}

	.onboardingScrollRail {
		position: absolute;
		top: 12px;
		right: 5px;
		bottom: 12px;
		width: var(--scrollbar-size);
		border-radius: var(--scrollbar-radius);
		background: var(--scrollbar-track-bg);
	}

	.onboardingScrollThumb {
		width: 100%;
		border-radius: var(--scrollbar-radius);
		background: var(--scrollbar-thumb-bg);
		border: var(--scrollbar-thumb-border);
		cursor: grab;
	}

	.onboardingScrollThumb:hover {
		background: var(--scrollbar-thumb-bg-hover);
	}

	.onboardingScrollThumb.dragging {
		background: var(--scrollbar-thumb-bg-hover);
	}

	.onboardingScrollThumb:active {
		cursor: grabbing;
	}

	.onboardingImage {
		width: 100%;
		height: auto;
		max-height: 60dvh;
		object-fit: contain;
		border-radius: 12px;
		border: 1px solid var(--grid-2);
		background: var(--surface-0);
	}

	.onboardingImagePlaceholder {
		min-height: 220px;
		display: grid;
		place-items: center;
		border: 1px dashed var(--interactive-border-hover);
		border-radius: 12px;
		color: var(--muted);
		padding: 16px;
		text-align: center;
		background: var(--surface-0);
	}

	.onboardingDescription {
		margin: 0;
		white-space: pre-wrap;
		line-height: 1.45;
		color: var(--text);
	}

	.onboardingFooter {
		padding: 12px 18px 16px;
		border-top: 1px solid var(--grid-2);
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-areas:
			'error error'
			'left right';
		align-items: center;
		gap: 12px;
	}

	.onboardingFooterLeft {
		grid-area: left;
		display: inline-flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.onboardingCheckbox {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		color: var(--text);
	}

	.onboardingError {
		grid-area: error;
		margin: 0;
		width: 100%;
		color: #fecaca;
		font-size: 13px;
	}

	.onboardingActions {
		grid-area: right;
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.navBtn,
	.finishBtn {
		appearance: none;
		border-radius: 10px;
		border: 1px solid var(--interactive-border);
		background: var(--interactive-bg);
		color: var(--text);
		font-weight: 700;
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			box-shadow 0.12s ease,
			transform 0.08s ease;
	}

	.navBtn {
		min-width: 42px;
		padding: 8px 12px;
		font-size: 18px;
	}

	.finishBtn {
		padding: 8px 14px;
		font-size: 14px;
	}

	.navBtn:hover:not(:disabled),
	.finishBtn:hover:not(:disabled) {
		background: var(--interactive-bg-hover);
		border-color: var(--interactive-border-hover);
		box-shadow: var(--shadow-soft);
	}

	.navBtn:active:not(:disabled),
	.finishBtn:active:not(:disabled) {
		transform: translateY(1px);
		background: var(--interactive-bg-hover);
		border-color: var(--interactive-border-hover);
	}

	.navBtn:focus-visible,
	.finishBtn:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.navBtn:disabled,
	.finishBtn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	@media (max-width: 700px) {
		.onboardingLayer {
			padding: 10px;
		}

		.onboardingPanel {
			width: calc(100dvw - 20px);
			height: calc(100dvh - 20px);
		}

		.onboardingHeader h2 {
			font-size: 18px;
		}

		.onboardingBody {
			padding: 12px;
		}

		.onboardingFooter {
			padding: 10px 12px 12px;
			grid-template-columns: 1fr;
			grid-template-areas:
				'error'
				'left'
				'right';
		}
	}
</style>
