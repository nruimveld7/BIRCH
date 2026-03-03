<script lang="ts">
	import { afterUpdate, createEventDispatcher, onDestroy, onMount } from 'svelte';

	export type PickerItem = { value: number | string; label: string; color?: string };

	export let id = '';
	export let menuId = '';
	export let label = '';
	export let items: PickerItem[] = [];
	export let selectedValue: number | string;
	export let selectedLabel = '';
	export let open = false;
	export let fullWidth = false;
	export let onOpenChange: (next: boolean) => void = () => {};

	const dispatch = createEventDispatcher<{ select: number | string }>();

	let rootEl: HTMLDivElement | null = null;
	let menuEl: HTMLDivElement | null = null;
	let railEl: HTMLDivElement | null = null;
	let showMenuScrollbar = false;
	let thumbHeightPx = 0;
	let thumbTopPx = 0;
	let isDraggingScrollbar = false;
	let dragStartY = 0;
	let dragStartThumbTopPx = 0;

	$: resolvedMenuId = menuId || `${id}-menu`;
	$: selectedItem = items.find((item) => item.value === selectedValue);

	function setOpen(next: boolean) {
		if (open === next) return;
		open = next;
		onOpenChange(next);
	}

	function toggle() {
		setOpen(!open);
	}

	function select(value: number | string) {
		dispatch('select', value);
		setOpen(false);
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

	function updateMenuScrollbar() {
		if (!menuEl) return;
		const scrollHeight = menuEl.scrollHeight;
		const clientHeight = menuEl.clientHeight;
		const scrollTop = menuEl.scrollTop;
		const hasOverflow = scrollHeight > clientHeight + 1;

		showMenuScrollbar = hasOverflow;
		if (!hasOverflow) {
			thumbHeightPx = 0;
			thumbTopPx = 0;
			return;
		}

		const railHeight = railEl?.clientHeight ?? Math.max(clientHeight - 16, 0);
		if (railHeight <= 0) return;

		const minThumbHeight = 36;
		const nextThumbHeight = Math.max(minThumbHeight, (railHeight * clientHeight) / scrollHeight);
		const maxThumbTop = Math.max(railHeight - nextThumbHeight, 0);
		const maxScrollTop = Math.max(scrollHeight - clientHeight, 1);
		const nextThumbTop = (scrollTop / maxScrollTop) * maxThumbTop;

		thumbHeightPx = nextThumbHeight;
		thumbTopPx = clamp(nextThumbTop, 0, maxThumbTop);
	}

	function onMenuScroll() {
		if (!isDraggingScrollbar) {
			updateMenuScrollbar();
		}
	}

	function onDragMove(event: MouseEvent) {
		if (!isDraggingScrollbar || !menuEl || !railEl) return;

		const railHeight = railEl.clientHeight;
		const maxThumbTop = Math.max(railHeight - thumbHeightPx, 0);
		const nextThumbTop = clamp(dragStartThumbTopPx + (event.clientY - dragStartY), 0, maxThumbTop);
		const maxScrollTop = Math.max(menuEl.scrollHeight - menuEl.clientHeight, 0);

		thumbTopPx = nextThumbTop;
		menuEl.scrollTop = maxThumbTop > 0 ? (nextThumbTop / maxThumbTop) * maxScrollTop : 0;
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
		if (!showMenuScrollbar) return;
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
		if (!menuEl || !railEl || !showMenuScrollbar) return;
		if (event.target !== railEl) return;

		const rect = railEl.getBoundingClientRect();
		const desiredTop = clamp(
			event.clientY - rect.top - thumbHeightPx / 2,
			0,
			Math.max(rect.height - thumbHeightPx, 0)
		);
		const maxThumbTop = Math.max(rect.height - thumbHeightPx, 1);
		const maxScrollTop = Math.max(menuEl.scrollHeight - menuEl.clientHeight, 0);
		menuEl.scrollTop = (desiredTop / maxThumbTop) * maxScrollTop;
		updateMenuScrollbar();
	}

	function handleDocMouseDown(event: MouseEvent) {
		if (!open || !rootEl) return;
		const target = event.target as Node;
		if (!rootEl.contains(target)) setOpen(false);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			setOpen(false);
		}
	}

	onMount(() => {
		document.addEventListener('mousedown', handleDocMouseDown);
		document.addEventListener('keydown', handleKeydown);
		const onResize = () => updateMenuScrollbar();
		window.addEventListener('resize', onResize);
		return () => {
			document.removeEventListener('mousedown', handleDocMouseDown);
			document.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('resize', onResize);
		};
	});

	afterUpdate(() => {
		if (open && typeof window !== 'undefined') {
			requestAnimationFrame(updateMenuScrollbar);
		}
	});

	$: if (!open) {
		stopDragging();
	}

	onDestroy(() => {
		stopDragging();
		if (typeof document !== 'undefined' && !document.body.dataset.scrollbarDragCount) {
			document.body.classList.remove('scrollbar-dragging');
		}
	});
</script>

<div class="picker" class:open class:fullWidth bind:this={rootEl}>
	<button
		class="pickerBtn"
		{id}
		type="button"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={resolvedMenuId}
		on:click|stopPropagation={toggle}
	>
		<span class="pickerBtnValue">
			{#if selectedItem?.color}
				<span class="pickerColorDot" style={`background:${selectedItem.color};`} aria-hidden="true"></span>
			{/if}
			<span>{selectedLabel}</span>
		</span>
		<span class="chev" aria-hidden="true">▾</span>
	</button>
	<div
		class={`pickerMenu${open ? ' open' : ''}`}
		id={resolvedMenuId}
		role="listbox"
		aria-label={label}
	>
		<div
			class="pickerMenuScroll"
			class:hasScrollbar={showMenuScrollbar}
			bind:this={menuEl}
			on:scroll={onMenuScroll}
		>
			{#each items as item (item.value)}
				<button
					class="pickerItem"
					type="button"
					role="option"
					aria-selected={item.value === selectedValue}
					on:click={() => select(item.value)}
				>
					<span class="pickerItemLabel">
						{#if item.color}
							<span class="pickerColorDot" style={`background:${item.color};`} aria-hidden="true"></span>
						{/if}
						<span>{item.label}</span>
					</span>
					{#if item.value === selectedValue}
						<span class="check">✓</span>
					{/if}
				</button>
			{/each}
		</div>
		{#if showMenuScrollbar}
			<div
				class="pickerScrollRail"
				role="presentation"
				aria-hidden="true"
				bind:this={railEl}
				on:mousedown={handleRailClick}
			>
				<div
					class="pickerScrollThumb"
					class:dragging={isDraggingScrollbar}
					role="presentation"
					style={`height:${thumbHeightPx}px;transform:translateY(${thumbTopPx}px);`}
					on:mousedown={startThumbDrag}
				></div>
			</div>
		{/if}
	</div>
</div>
