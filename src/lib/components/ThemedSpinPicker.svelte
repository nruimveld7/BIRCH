<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let id = '';
	export let label = '';
	export let value: string | number = '';
	export let disabled = false;
	export let options: Array<string | number> = [];
	const dispatch = createEventDispatcher<{ value: string | number }>();

	$: hasOptions = options.length > 0;
	$: normalizedIndex = hasOptions
		? (() => {
				const target = String(value);
				const index = options.findIndex((option) => String(option) === target);
				return index >= 0 ? index : 0;
			})()
		: -1;
	$: canDecrement = hasOptions && normalizedIndex > 0;
	$: canIncrement = hasOptions && normalizedIndex < options.length - 1;
	$: displayValue = hasOptions ? String(options[normalizedIndex] ?? '') : String(value ?? '');

	function setValue(next: string | number) {
		if (value === next) return;
		value = next;
		dispatch('value', next);
	}

	function stepUp() {
		if (disabled || !canIncrement) return;
		setValue(options[normalizedIndex + 1]);
	}

	function stepDown() {
		if (disabled || !canDecrement) return;
		setValue(options[normalizedIndex - 1]);
	}
</script>

<div class={`themedSpinPicker${disabled ? ' disabled' : ''}`}>
	{#if label}
		<label class="themedSpinPickerLabel" for={id || undefined}>{label}</label>
	{/if}
	<div class="themedSpinPickerBody">
		<button
			type="button"
			class="themedSpinPickerArrow"
			on:click={stepUp}
			aria-label={`Increase ${label || 'value'}`}
			disabled={disabled || !canIncrement}
		>
			<svg viewBox="0 0 20 20" aria-hidden="true">
				<path d="M5 12.5L10 7.5L15 12.5" />
			</svg>
		</button>
		<div id={id || undefined} class="themedSpinPickerValue" aria-live="polite">
			{displayValue}
		</div>
		<button
			type="button"
			class="themedSpinPickerArrow"
			on:click={stepDown}
			aria-label={`Decrease ${label || 'value'}`}
			disabled={disabled || !canDecrement}
		>
			<svg viewBox="0 0 20 20" aria-hidden="true">
				<path d="M5 7.5L10 12.5L15 7.5" />
			</svg>
		</button>
	</div>
</div>

<style>
	.themedSpinPicker {
		display: grid;
		gap: 5px;
		min-width: 0;
		width: 100%;
		justify-items: center;
	}

	.themedSpinPicker.disabled {
		opacity: 0.62;
	}

	.themedSpinPickerLabel {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.02em;
		color: var(--muted);
	}

	.themedSpinPickerBody {
		display: grid;
		grid-template-columns: 28px minmax(0, 1fr) 28px;
		align-items: center;
		border: 1px solid var(--interactive-border);
		border-radius: 9px;
		background: var(--input-bg);
		min-height: 36px;
		overflow: hidden;
		width: 100%;
	}

	.themedSpinPickerArrow {
		appearance: none;
		border: 0;
		background: transparent;
		color: var(--text);
		height: 100%;
		cursor: pointer;
		display: grid;
		place-items: center;
	}

	.themedSpinPickerArrow:hover {
		background: var(--interactive-bg-hover);
	}

	.themedSpinPickerArrow:disabled {
		opacity: 0.38;
		cursor: not-allowed;
	}

	.themedSpinPickerArrow:disabled:hover {
		background: transparent;
	}

	.themedSpinPickerArrow:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px var(--interactive-border-hover);
	}

	.themedSpinPickerArrow svg {
		width: 13px;
		height: 13px;
		stroke: currentColor;
		stroke-width: 2.2;
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.themedSpinPickerValue {
		padding: 0 8px;
		text-align: center;
		font-size: 13px;
		font-weight: 760;
		color: var(--text);
		border-left: 1px solid var(--interactive-border);
		border-right: 1px solid var(--interactive-border);
	}
</style>
