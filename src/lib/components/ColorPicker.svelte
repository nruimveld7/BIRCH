<script lang="ts">
	import { createEventDispatcher, onMount, tick } from 'svelte';

	export let value = '#c8102e';
	export let disabled = false;
	export let id = '';
	export let label = 'Color';

	const dispatch = createEventDispatcher<{ change: string }>();

	let open = false;
	let rootEl: HTMLDivElement | null = null;
	let triggerEl: HTMLButtonElement | null = null;
	let popoverEl: HTMLDivElement | null = null;
	let svEl: HTMLDivElement | null = null;
	let hexDraft = '#c8102e';
	let hue = 0;
	let sat = 1;
	let val = 1;
	let isDraggingSv = false;
	let popoverTopPx = 0;
	let popoverLeftPx = 0;
	let popoverPlacement: 'top' | 'bottom' = 'bottom';

	function updatePopoverPosition() {
		if (!open || !triggerEl) return;
		const rect = triggerEl.getBoundingClientRect();
		const gap = 8;
		const viewportPadding = 12;
		const popoverHeight = popoverEl?.offsetHeight ?? 320;
		const popoverWidth = popoverEl?.offsetWidth ?? 240;
		const spaceBelow = window.innerHeight - rect.bottom - gap;
		const spaceAbove = rect.top - gap;

		popoverPlacement =
			spaceBelow < popoverHeight && spaceAbove > spaceBelow ? 'top' : 'bottom';
		popoverTopPx = popoverPlacement === 'top' ? rect.top - gap : rect.bottom + gap;

		const centeredLeft = rect.left + rect.width / 2;
		const minLeft = viewportPadding + popoverWidth / 2;
		const maxLeft = window.innerWidth - viewportPadding - popoverWidth / 2;
		popoverLeftPx = Math.max(minLeft, Math.min(maxLeft, centeredLeft));
	}

	async function syncPopoverPosition() {
		updatePopoverPosition();
		await tick();
		updatePopoverPosition();
	}

	function normalizeHexColor(input: string, fallback: string): string {
		const trimmed = input.trim().toLowerCase();
		const hexMatch = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
		if (!hexMatch) return fallback;
		const raw = hexMatch[1];
		if (raw.length === 3) {
			return `#${raw
				.split('')
				.map((part) => `${part}${part}`)
				.join('')}`;
		}
		return `#${raw}`;
	}

	function parseHexColor(input: string): string | null {
		const normalized = normalizeHexColor(input, '');
		return normalized ? normalized : null;
	}

	function hexToRgb(hex: string): { r: number; g: number; b: number } {
		const normalized = normalizeHexColor(hex, '#000000').slice(1);
		return {
			r: Number.parseInt(normalized.slice(0, 2), 16),
			g: Number.parseInt(normalized.slice(2, 4), 16),
			b: Number.parseInt(normalized.slice(4, 6), 16)
		};
	}

	function rgbToHex(r: number, g: number, b: number): string {
		return `#${[r, g, b]
			.map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0'))
			.join('')}`;
	}

	function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
		const rn = r / 255;
		const gn = g / 255;
		const bn = b / 255;
		const max = Math.max(rn, gn, bn);
		const min = Math.min(rn, gn, bn);
		const delta = max - min;
		let h = 0;
		if (delta !== 0) {
			if (max === rn) {
				h = 60 * (((gn - bn) / delta) % 6);
			} else if (max === gn) {
				h = 60 * ((bn - rn) / delta + 2);
			} else {
				h = 60 * ((rn - gn) / delta + 4);
			}
		}
		if (h < 0) h += 360;
		const s = max === 0 ? 0 : delta / max;
		const v = max;
		return { h, s, v };
	}

	function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
		const hueSafe = ((h % 360) + 360) % 360;
		const c = v * s;
		const x = c * (1 - Math.abs(((hueSafe / 60) % 2) - 1));
		const m = v - c;
		let rp = 0;
		let gp = 0;
		let bp = 0;
		if (hueSafe < 60) {
			rp = c;
			gp = x;
		} else if (hueSafe < 120) {
			rp = x;
			gp = c;
		} else if (hueSafe < 180) {
			gp = c;
			bp = x;
		} else if (hueSafe < 240) {
			gp = x;
			bp = c;
		} else if (hueSafe < 300) {
			rp = x;
			bp = c;
		} else {
			rp = c;
			bp = x;
		}
		return {
			r: (rp + m) * 255,
			g: (gp + m) * 255,
			b: (bp + m) * 255
		};
	}

	function syncFromHex(nextHex: string) {
		const rgb = hexToRgb(nextHex);
		const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
		hue = hsv.h;
		sat = hsv.s;
		val = hsv.v;
		hexDraft = nextHex;
	}

	function emitFromHsv() {
		const rgb = hsvToRgb(hue, sat, val);
		const nextHex = rgbToHex(rgb.r, rgb.g, rgb.b);
		hexDraft = nextHex;
		dispatch('change', nextHex);
	}

	function toggleOpen() {
		if (disabled) return;
		open = !open;
		if (open) {
			void syncPopoverPosition();
		}
	}

	export function openPicker() {
		if (disabled || open) return;
		open = true;
		void syncPopoverPosition();
	}

	export function closePicker() {
		close();
	}

	function close() {
		open = false;
	}

	function updateSvFromPointer(clientX: number, clientY: number) {
		if (!svEl) return;
		const rect = svEl.getBoundingClientRect();
		const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
		const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
		sat = rect.width > 0 ? x / rect.width : 0;
		val = rect.height > 0 ? 1 - y / rect.height : 0;
		emitFromHsv();
	}

	function onSvPointerDown(event: PointerEvent) {
		event.preventDefault();
		isDraggingSv = true;
		updateSvFromPointer(event.clientX, event.clientY);
	}

	function onDocPointerMove(event: PointerEvent) {
		if (!isDraggingSv) return;
		updateSvFromPointer(event.clientX, event.clientY);
	}

	function onDocPointerUp() {
		isDraggingSv = false;
	}

	function onHueInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		hue = Number(input.value);
		emitFromHsv();
	}

	function onHexInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		hexDraft = input.value;
		const normalized = parseHexColor(hexDraft);
		if (!normalized || normalized === normalizedValue) return;
		syncFromHex(normalized);
		dispatch('change', normalized);
	}

	function commitHexDraft() {
		const normalized = parseHexColor(hexDraft) ?? normalizedValue;
		hexDraft = normalized;
		syncFromHex(normalized);
		dispatch('change', normalized);
	}

	function onHexKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			commitHexDraft();
			close();
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			hexDraft = value;
			close();
		}
	}

	function handleDocMouseDown(event: MouseEvent) {
		if (!open || !rootEl) return;
		const target = event.target as Node | null;
		if (target && rootEl.contains(target)) return;
		close();
	}

	function handleDocKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	}

	function handleWindowResize() {
		updatePopoverPosition();
	}

	function handleAnyScroll() {
		updatePopoverPosition();
	}

	$: normalizedValue = normalizeHexColor(value, '#c8102e');
	$: if (normalizedValue !== hexDraft && !isDraggingSv) {
		syncFromHex(normalizedValue);
	}

	$: svCursorLeft = `${(sat * 100).toFixed(2)}%`;
	$: svCursorTop = `${((1 - val) * 100).toFixed(2)}%`;
	$: if (open) {
		void syncPopoverPosition();
	}

	onMount(() => {
		document.addEventListener('mousedown', handleDocMouseDown);
		document.addEventListener('keydown', handleDocKeydown);
		document.addEventListener('pointermove', onDocPointerMove);
		document.addEventListener('pointerup', onDocPointerUp);
		window.addEventListener('resize', handleWindowResize);
		document.addEventListener('scroll', handleAnyScroll, true);
		return () => {
			document.removeEventListener('mousedown', handleDocMouseDown);
			document.removeEventListener('keydown', handleDocKeydown);
			document.removeEventListener('pointermove', onDocPointerMove);
			document.removeEventListener('pointerup', onDocPointerUp);
			window.removeEventListener('resize', handleWindowResize);
			document.removeEventListener('scroll', handleAnyScroll, true);
		};
	});
</script>

<div class="colorPicker" bind:this={rootEl}>
	<button
		type="button"
		class="colorPickerTrigger"
		bind:this={triggerEl}
		{id}
		aria-label={label}
		aria-haspopup="dialog"
		aria-expanded={open}
		on:click|stopPropagation={toggleOpen}
		{disabled}
	>
		<span class="swatch" style={`background:${normalizedValue};`}></span>
		<span class="hexLabel">{normalizedValue.toUpperCase()}</span>
		<span class="chev" aria-hidden="true">▾</span>
	</button>

	{#if open}
		<div
			class="colorPickerPopover"
			class:top={popoverPlacement === 'top'}
			role="dialog"
			aria-label={`${label} picker`}
			bind:this={popoverEl}
			style={`top:${popoverTopPx}px;left:${popoverLeftPx}px;`}
		>
			<div
				class="svArea"
				bind:this={svEl}
				style={`--hue:${hue.toFixed(2)};`}
				on:pointerdown={onSvPointerDown}
			>
				<div class="svCursor" style={`left:${svCursorLeft};top:${svCursorTop};`}></div>
			</div>

			<label class="controlRow" for={`${id || label}-hue`}>
				<span>Hue</span>
				<input
					id={`${id || label}-hue`}
					type="range"
					min="0"
					max="360"
					step="1"
					value={hue}
					on:input={onHueInput}
				/>
			</label>

			<label class="controlRow" for={`${id || label}-hex`}>
				<span>Hex</span>
				<input
					id={`${id || label}-hex`}
					class="hexInput"
					type="text"
					inputmode="text"
					spellcheck="false"
					value={hexDraft}
					on:input={onHexInput}
					on:blur={commitHexDraft}
					on:keydown={onHexKeydown}
				/>
			</label>
		</div>
	{/if}
</div>

<style>
	.colorPicker {
		position: relative;
		display: inline-block;
		width: 100%;
		z-index: 3;
	}

	.colorPickerTrigger {
		width: 100%;
		min-height: 38px;
		padding: 6px 10px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		border: 1px solid var(--interactive-border);
		border-radius: 10px;
		background: var(--input-bg);
		color: var(--text);
		cursor: pointer;
	}

	.colorPickerTrigger:hover {
		border-color: var(--interactive-border-hover);
	}

	.colorPickerTrigger:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.swatch {
		width: 18px;
		height: 18px;
		border-radius: 5px;
		border: 1px solid var(--interactive-border);
		flex: 0 0 auto;
	}

	.hexLabel {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.03em;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
	}

	.chev {
		margin-left: auto;
		font-size: 11px;
		opacity: 0.8;
	}

	.colorPickerPopover {
		position: fixed;
		top: 0;
		left: 0;
		transform: translateX(-50%);
		z-index: 1200;
		width: 240px;
		padding: 10px;
		border-radius: 12px;
		border: 1px solid var(--interactive-border);
		background-color: var(--bg-2);
		background-image:
			linear-gradient(
				180deg,
				var(--gradient-popover-start),
				var(--gradient-popover-end) 100%
			);
		box-shadow: var(--shadow-soft);
		display: grid;
		gap: 10px;
	}

	.colorPickerPopover.top {
		transform: translate(-50%, -100%);
	}

	.svArea {
		position: relative;
		width: 100%;
		aspect-ratio: 1 / 1;
		border-radius: 10px;
		border: 1px solid var(--interactive-border);
		background: hsl(var(--hue) 100% 50%);
		overflow: hidden;
		touch-action: none;
		cursor: crosshair;
	}

	.svArea::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, #fff, rgba(255, 255, 255, 0));
	}

	.svArea::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, rgba(0, 0, 0, 0), #000);
	}

	.svCursor {
		position: absolute;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid #fff;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
		transform: translate(-50%, -50%);
		z-index: 2;
		pointer-events: none;
	}

	.controlRow {
		display: grid;
		gap: 6px;
	}

	.controlRow > span {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.03em;
		color: var(--muted);
	}

	input[type='range'] {
		appearance: none;
		width: 100%;
		height: 8px;
		border-radius: 999px;
		border: 1px solid var(--interactive-border);
		background: linear-gradient(
			90deg,
			#ff0000 0%,
			#ffff00 17%,
			#00ff00 33%,
			#00ffff 50%,
			#0000ff 67%,
			#ff00ff 83%,
			#ff0000 100%
		);
	}

	input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 1px solid var(--interactive-border);
		background: var(--input-bg);
	}

	input[type='range']::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 1px solid var(--interactive-border);
		background: var(--input-bg);
	}

	.hexInput {
		width: 100%;
		min-height: 34px;
		padding: 6px 8px;
		border-radius: 8px;
		border: 1px solid var(--interactive-border);
		background: var(--input-bg);
		color: var(--text);
		font-size: 12px;
		font-weight: 750;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
	}

	.hexInput:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
</style>
