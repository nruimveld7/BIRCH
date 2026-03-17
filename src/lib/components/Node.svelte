<script lang="ts">
	import { afterUpdate, createEventDispatcher, onDestroy, onMount } from 'svelte';

	export let id: string;
	export let title = '';
	export let x = 0;
	export let y = 0;
	export let width = 290;
	export let height = 140;
	export let draggable = true;
	export let editable = true;
	export let pinned = false;
	export let hasBodyContent: boolean | null = null;
	export let dragScale = 1;
	export let renderScale = 1;
	export let lockedPointerX: number | null = null;
	export let lockedPointerY: number | null = null;
	export let spacePressed = false;
	export let showConnectors = false;
	export let renderTitleInline = true;
	export let interactionLocked = false;
	export let cancelDragToken = 0;

	type NodeConnectorSide = 'top' | 'right' | 'bottom' | 'left';
	const connectors: NodeConnectorSide[] = ['top', 'right', 'bottom', 'left'];

	const dispatch = createEventDispatcher<{
		move: {
			id: string;
			x: number;
			y: number;
			pointerX: number;
			pointerY: number;
			ctrlKey: boolean;
			shiftKey: boolean;
			spaceKey: boolean;
		};
		titlechange: { id: string; title: string };
		dragstart: { id: string; pointerX: number; pointerY: number };
		dragend: { id: string };
		widthchange: { id: string; width: number };
		heightchange: { id: string; height: number };
		activate: { id: string };
		deleterequest: { id: string };
		contextrequest: { id: string; pointerX: number; pointerY: number };
		connectordragstart: {
			id: string;
			side: NodeConnectorSide;
			pointerX: number;
			pointerY: number;
			pointerId: number;
		};
	}>();

	let dragging = false;
	let dragPointerId: number | null = null;
	let dragStartPointerX = 0;
	let dragStartPointerY = 0;
	let dragStartNodeX = 0;
	let dragStartNodeY = 0;
	let dragScaleSnapshot = 1;
	let activePointerX = 0;
	let activePointerY = 0;
	let dragSpacePressed = false;
	let hasDefaultSlot = false;
	let showBody = false;
	let titleMeasureEl: HTMLSpanElement | null = null;
	let articleEl: HTMLElement | null = null;
	let sizeObserver: ResizeObserver | null = null;
	let effectiveWidth = width;
	let titleForSizing = 'Untitled node';
	let titleInputSize = titleForSizing.length;
	let lastDispatchedHeight = 0;
	let lastCancelDragToken = cancelDragToken;

	function addGlobalDragListeners() {
		if (typeof window === 'undefined') return;
		window.addEventListener('pointermove', continueDrag as EventListener, { passive: false });
		window.addEventListener('pointerup', endDrag as EventListener, { passive: false });
		window.addEventListener('pointercancel', endDrag as EventListener, { passive: false });
		window.addEventListener('keydown', handleDragModifierKey as EventListener);
		window.addEventListener('keyup', handleDragModifierKey as EventListener);
	}

	function removeGlobalDragListeners() {
		if (typeof window === 'undefined') return;
		window.removeEventListener('pointermove', continueDrag as EventListener);
		window.removeEventListener('pointerup', endDrag as EventListener);
		window.removeEventListener('pointercancel', endDrag as EventListener);
		window.removeEventListener('keydown', handleDragModifierKey as EventListener);
		window.removeEventListener('keyup', handleDragModifierKey as EventListener);
	}

	$: hasDefaultSlot = Boolean($$slots.default);
	$: showBody = hasBodyContent ?? (editable || hasDefaultSlot);
	$: titleForSizing = title.length > 0 ? title : 'Untitled node';
	$: titleInputSize = Math.max(1, titleForSizing.length);

	function syncWidthToHeader() {
		const effectiveScale = dragScale > 0 ? dragScale * renderScale : renderScale;
		const measuredTitleWidth =
			(titleMeasureEl?.getBoundingClientRect().width ?? 0) / effectiveScale;
		const headerHorizontalPadding = 24;
		const nextWidth = Math.max(width, Math.ceil(measuredTitleWidth + headerHorizontalPadding));
		if (Math.abs(nextWidth - effectiveWidth) < 0.5) return;
		effectiveWidth = nextWidth;
		dispatch('widthchange', { id, width: nextWidth });
	}

	function syncHeightToRenderedSize() {
		if (!articleEl) return;
		const effectiveScale = dragScale > 0 ? dragScale * renderScale : renderScale;
		const nextHeight = Math.ceil(articleEl.getBoundingClientRect().height / effectiveScale);
		if (Math.abs(nextHeight - lastDispatchedHeight) < 1) return;
		lastDispatchedHeight = nextHeight;
		dispatch('heightchange', { id, height: nextHeight });
	}

	function resolveDragPointer(pointerX: number, pointerY: number) {
		return {
			x: lockedPointerX ?? pointerX,
			y: lockedPointerY ?? pointerY
		};
	}

	$: {
		if (dragging) {
			const effectiveScale = dragScale > 0 ? dragScale : 1;
			const effectivePointer = resolveDragPointer(activePointerX, activePointerY);
			const dx = effectivePointer.x - dragStartPointerX;
			const dy = effectivePointer.y - dragStartPointerY;
			const projectedX = dragStartNodeX + dx / effectiveScale;
			const projectedY = dragStartNodeY + dy / effectiveScale;
			const shouldRebaseForExternalPosition =
				lockedPointerX !== null ||
				lockedPointerY !== null;
			// Rebase drag origin for scale changes and pointer-lock edge-pan adjustments.
			if (
				Math.abs(effectiveScale - dragScaleSnapshot) > 0.0001 ||
				(shouldRebaseForExternalPosition &&
					(Math.abs(projectedX - x) > 0.0001 || Math.abs(projectedY - y) > 0.0001))
			) {
				dragStartNodeX = x - dx / effectiveScale;
				dragStartNodeY = y - dy / effectiveScale;
			}
			dragScaleSnapshot = effectiveScale;
		}
	}

	function beginDrag(event: PointerEvent) {
		if (interactionLocked) return;
		if (!draggable || event.button !== 0) return;
		const targetEl = event.target as HTMLElement | null;
		if (
			targetEl?.closest(
				'input, textarea, select, button, a, [role="button"], [role="combobox"], [role="listbox"], [role="option"], [contenteditable="true"], [data-node-no-drag]'
			)
		) {
			return;
		}
		const effectiveScale = dragScale > 0 ? dragScale : 1;
		const effectivePointer = resolveDragPointer(event.clientX, event.clientY);
		dragging = true;
		dragPointerId = event.pointerId;
		dragStartPointerX = effectivePointer.x;
		dragStartPointerY = effectivePointer.y;
		activePointerX = event.clientX;
		activePointerY = event.clientY;
		dragStartNodeX = x;
		dragStartNodeY = y;
		dragScaleSnapshot = effectiveScale;
		dragSpacePressed = spacePressed;
		articleEl?.setPointerCapture(event.pointerId);
		addGlobalDragListeners();
		dispatch('dragstart', { id, pointerX: event.clientX, pointerY: event.clientY });
		event.preventDefault();
	}

	function continueDrag(event: PointerEvent) {
		if (!dragging || dragPointerId !== event.pointerId) return;
		activePointerX = event.clientX;
		activePointerY = event.clientY;
		dispatchDragMove(event.clientX, event.clientY, event.ctrlKey, event.shiftKey, dragSpacePressed);
	}

	function dispatchDragMove(
		pointerX: number,
		pointerY: number,
		ctrlKey: boolean,
		shiftKey: boolean,
		spaceKey: boolean
	) {
		const effectiveScale = dragScale > 0 ? dragScale : 1;
		const effectivePointer = resolveDragPointer(pointerX, pointerY);
		const nextX = dragStartNodeX + (effectivePointer.x - dragStartPointerX) / effectiveScale;
		const nextY = dragStartNodeY + (effectivePointer.y - dragStartPointerY) / effectiveScale;
		dispatch('move', {
			id,
			x: nextX,
			y: nextY,
			pointerX,
			pointerY,
			ctrlKey,
			shiftKey,
			spaceKey
		});
	}

	function handleDragModifierKey(event: KeyboardEvent) {
		const isSpace = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar';
		if (isSpace) {
			dragSpacePressed = event.type === 'keydown';
		}
		if (!dragging || (event.key !== 'Control' && event.key !== 'Shift' && !isSpace)) return;
		dispatchDragMove(activePointerX, activePointerY, event.ctrlKey, event.shiftKey, dragSpacePressed);
	}

	function endDrag(event: PointerEvent) {
		if (!dragging || dragPointerId !== event.pointerId) return;
		dragging = false;
		const pointerId = dragPointerId;
		dragPointerId = null;
		dragSpacePressed = false;
		removeGlobalDragListeners();
		if (pointerId !== null && articleEl?.hasPointerCapture(pointerId)) {
			articleEl.releasePointerCapture(pointerId);
		}
		dispatch('dragend', { id });
	}

	function handleTitleInput(event: Event) {
		if (!editable) return;
		const nextTitle = (event.currentTarget as HTMLInputElement).value;
		dispatch('titlechange', { id, title: nextTitle });
	}

	function handleNodePointerDown(event: PointerEvent) {
		if (interactionLocked) return;
		if (event.button !== 0) return;
		dispatch('activate', { id });
		beginDrag(event);
	}

	function handleNodeMouseDownCapture(event: MouseEvent) {
		if (event.button !== 2) return;
		event.preventDefault();
		event.stopPropagation();
	}

	function handleNodeContextMenuCapture(event: MouseEvent) {
		if (!draggable) return;
		event.preventDefault();
		event.stopPropagation();
		dispatch('activate', { id });
		dispatch('contextrequest', { id, pointerX: event.clientX, pointerY: event.clientY });
	}

	function handleConnectorPointerDown(side: NodeConnectorSide, event: PointerEvent) {
		if (interactionLocked) return;
		if (!showConnectors || event.button !== 0) return;
		dispatch('activate', { id });
		dispatch('connectordragstart', {
			id,
			side,
			pointerX: event.clientX,
			pointerY: event.clientY,
			pointerId: event.pointerId
		});
		event.preventDefault();
		event.stopPropagation();
	}

	onMount(() => {
		syncWidthToHeader();
		syncHeightToRenderedSize();
		if (typeof ResizeObserver !== 'undefined' && articleEl) {
			sizeObserver = new ResizeObserver(() => {
				syncHeightToRenderedSize();
			});
			sizeObserver.observe(articleEl);
		}
		return () => {
			sizeObserver?.disconnect();
			sizeObserver = null;
		};
	});

	onDestroy(() => {
		removeGlobalDragListeners();
	});

	$: if (cancelDragToken !== lastCancelDragToken) {
		lastCancelDragToken = cancelDragToken;
		if (dragging) {
			const pointerId = dragPointerId;
			dragging = false;
			dragPointerId = null;
			dragSpacePressed = false;
			removeGlobalDragListeners();
			if (pointerId !== null && articleEl?.hasPointerCapture(pointerId)) {
				articleEl.releasePointerCapture(pointerId);
			}
			dispatch('dragend', { id });
		}
	}

	afterUpdate(() => {
		syncWidthToHeader();
		syncHeightToRenderedSize();
	});
</script>

<article
	bind:this={articleEl}
	class="node"
	class:dragging
	class:nodeLocked={!draggable}
	data-node-id={id}
	style={`left:${x}px;top:${y}px;width:${effectiveWidth}px;`}
	style:transform={`scale(${renderScale})`}
	aria-label={`Node ${title || id}`}
	on:mousedown|capture={handleNodeMouseDownCapture}
	on:contextmenu|capture={handleNodeContextMenuCapture}
	on:pointerdown={handleNodePointerDown}
>
	{#if pinned}
		<div class="nodePin" aria-hidden="true">
			<svg viewBox="0 0 24 24" focusable="false" class="nodePinIcon">
				<path d="M8 4h8l-1 3.6 2.6 3.8v1.6H6.4v-1.6L9 7.6 8 4Z" />
				<path d="M12 13v5.2" />
			</svg>
		</div>
	{/if}
	<header
		class="nodeHeader"
		class:nodeHeaderLocked={!draggable}
		class:nodeHeaderWithBody={showBody}
		class:nodeHeaderOnly={!showBody}
	>
		{#if renderTitleInline}
			<input
				class="nodeTitleInput"
				type="text"
				value={title}
				size={titleInputSize}
				placeholder="Untitled node"
				aria-label="Node title"
				readonly={!editable}
				on:input={handleTitleInput}
				on:pointerdown|stopPropagation
			/>
		{:else}
			<div class="nodeTitleSpacer" aria-hidden="true"></div>
		{/if}
		<span class="nodeTitleMeasure" bind:this={titleMeasureEl} aria-hidden="true"
			>{titleForSizing}</span
		>
	</header>
	{#if showBody}
		<div class="nodeBody">
			<slot />
		</div>
	{/if}
	{#if showConnectors}
		{#each connectors as side}
			<button
				type="button"
				class={`nodeConnector nodeConnector-${side}`}
				aria-label={`Connect from ${side} edge`}
				data-node-no-drag
				data-connector-node-id={id}
				data-connector-side={side}
				on:pointerdown={(event) => handleConnectorPointerDown(side, event)}
			></button>
		{/each}
	{/if}
	<slot name="overlay" />
</article>

<style>
	.node {
		--text: var(--node-text);
		--muted: color-mix(in srgb, var(--node-text) 64%, transparent);
		--surface-1: var(--node-background);
		--surface-2: color-mix(in srgb, var(--node-background) 92%, var(--node-text) 8%);
		--interactive-bg: color-mix(in srgb, var(--node-background) 90%, var(--node-text) 10%);
		--interactive-bg-hover: color-mix(in srgb, var(--node-background) 84%, var(--node-text) 16%);
		--interactive-border: var(--node-border);
		--interactive-border-hover:
			color-mix(in srgb, var(--canvas-accent, var(--node-border)) 72%, var(--node-border));
		--accent: var(--canvas-accent, var(--node-connection));
		--accent-1: var(--canvas-accent-1, rgba(200, 16, 46, .62));
		position: absolute;
		display: flex;
		flex-direction: column;
		border-radius: 14px;
		border: 1px solid var(--node-border);
		background: var(--node-background);
		color: var(--node-text);
		box-shadow: var(--shadow-soft);
		overflow: visible;
		cursor: default;
		transform-origin: center center;
	}

	.node:not(.nodeLocked) {
		cursor: grab;
	}

	.node.dragging {
		box-shadow: var(--shadow-strong);
	}

	.node:not(.nodeLocked).dragging {
		cursor: grabbing;
	}

	.nodeConnector {
		appearance: none;
		position: absolute;
		width: 6px;
		height: 6px;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: crosshair;
		z-index: 45;
		touch-action: none;
	}

	.nodeConnector::before {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 6px;
		height: 6px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--node-border) 88%, white 12%);
		background: color-mix(in srgb, var(--node-connection) 84%, white 16%);
		box-shadow: 0 2px 8px color-mix(in srgb, black 26%, transparent);
		transform: translate(-50%, -50%);
	}

	.nodeConnector:hover::before {
		filter: brightness(1.08);
	}

	.nodeConnector:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.nodeConnector-top {
		left: 50%;
		top: 0;
		transform: translate(-50%, -50%);
	}
	.nodePin {
		position: absolute;
		top: -12px;
		left: -12px;
		width: 26px;
		height: 26px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--node-border) 82%, white 12%);
		background: color-mix(in srgb, var(--node-background) 92%, black 8%);
		box-shadow:
			0 4px 10px color-mix(in srgb, black 30%, transparent),
			inset 0 1px 0 color-mix(in srgb, white 10%, transparent);
		pointer-events: auto;
		z-index: 58;
	}
	.nodePinIcon {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: color-mix(in srgb, var(--node-text) 92%, white 8%);
		stroke-width: 1.9;
		stroke-linecap: round;
		stroke-linejoin: round;
		transform: rotate(45deg);
	}
	.nodeConnector-right {
		right: 0;
		top: 50%;
		transform: translate(50%, -50%);
	}

	.nodeConnector-bottom {
		left: 50%;
		bottom: 0;
		transform: translate(-50%, 50%);
	}

	.nodeConnector-left {
		left: 0;
		top: 50%;
		transform: translate(-50%, -50%);
	}

	.nodeHeader {
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		padding: 10px 12px;
		background: linear-gradient(
			180deg,
			var(--surface-2) 0%,
			var(--surface-1) 100%
		);
		touch-action: none;
		border-radius: 14px 14px 0 0;
	}

	.nodeHeader.nodeHeaderWithBody {
		border-bottom: 1px solid var(--node-border);
	}

	.nodeHeader.nodeHeaderOnly {
		border-radius: 14px;
	}

	.nodeHeader.nodeHeaderLocked {
		cursor: default;
	}

	.nodeHeader:active {
		cursor: grabbing;
	}

	.nodeHeader.nodeHeaderLocked:active {
		cursor: default;
	}

	.nodeTitleInput {
		width: auto;
		max-width: 100%;
		border: 0;
		background: transparent;
		color: var(--text);
		font-size: 14px;
		font-weight: 700;
		text-align: center;
		outline: none;
		padding: 0;
	}

	.nodeTitleSpacer {
		width: 100%;
		height: 16px;
	}

	.nodeTitleInput::placeholder {
		color: var(--muted);
	}

	.nodeTitleInput:focus::placeholder {
		color: transparent;
	}

	.nodeTitleInput[readonly] {
		pointer-events: none;
	}

	.nodeTitleMeasure {
		position: absolute;
		visibility: hidden;
		pointer-events: none;
		white-space: pre;
		font-size: 14px;
		font-weight: 700;
	}

	.nodeBody {
		padding: 5px;
		flex: 0 0 auto;
	}
</style>
