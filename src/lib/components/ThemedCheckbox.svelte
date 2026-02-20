<script lang="ts">
	export let id = '';
	export let checked = false;
	export let disabled = false;
	export let label = '';
	export let description = '';
	export let compact = false;

	function handleChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		checked = input.checked;
	}
</script>

<label
	class={`themedCheckbox${compact ? ' compact' : ''}${disabled ? ' disabled' : ''}`}
	for={id || undefined}
>
	<span class="themedCheckboxControl">
		<input id={id || undefined} type="checkbox" bind:checked on:change={handleChange} {disabled} />
		<span class="themedCheckboxIcon" aria-hidden="true">
			<svg viewBox="0 0 20 20">
				<path d="M4.75 10.2L8.35 13.8L15.3 6.85" />
			</svg>
		</span>
	</span>
	<span class="themedCheckboxBody">
		<span class="themedCheckboxLabel">{label}</span>
		{#if description}
			<span class="themedCheckboxDescription">{description}</span>
		{/if}
	</span>
</label>

<style>
	.themedCheckbox {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		color: var(--text);
		cursor: pointer;
	}

	.themedCheckbox.compact {
		gap: 8px;
	}

	.themedCheckbox.disabled {
		opacity: 0.62;
		cursor: not-allowed;
	}

	.themedCheckboxControl {
		position: relative;
		width: 20px;
		height: 20px;
		flex: 0 0 20px;
	}

	.themedCheckboxControl input {
		position: absolute;
		inset: 0;
		opacity: 0;
		margin: 0;
		cursor: inherit;
	}

	.themedCheckboxIcon {
		position: absolute;
		inset: 0;
		border-radius: 6px;
		border: 1px solid var(--interactive-border);
		background: var(--input-bg);
		display: grid;
		place-items: center;
		transition:
			border-color 0.14s ease,
			background 0.14s ease,
			box-shadow 0.14s ease;
	}

	.themedCheckboxIcon svg {
		width: 14px;
		height: 14px;
		stroke: #fff;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
		fill: none;
		opacity: 0;
		transform: scale(0.85);
		transition:
			opacity 0.12s ease,
			transform 0.12s ease;
	}

	.themedCheckbox:hover .themedCheckboxIcon {
		border-color: var(--interactive-border-hover);
	}

	.themedCheckboxControl input:focus-visible + .themedCheckboxIcon {
		box-shadow: var(--focus-ring);
	}

	.themedCheckboxControl input:checked + .themedCheckboxIcon {
		border-color: color-mix(in srgb, var(--accent) 68%, var(--interactive-border));
		background: linear-gradient(
			145deg,
			color-mix(in srgb, var(--accent) 88%, #fff 12%),
			color-mix(in srgb, var(--accent) 76%, #000 24%)
		);
	}

	.themedCheckboxControl input:checked + .themedCheckboxIcon svg {
		opacity: 1;
		transform: scale(1);
	}

	.themedCheckboxBody {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.themedCheckboxLabel {
		font-size: 13px;
		line-height: 1.25;
		font-weight: 700;
	}

	.themedCheckboxDescription {
		font-size: 11px;
		line-height: 1.3;
		color: var(--muted);
	}
</style>
