<script lang="ts">
	import '$lib/styles/theme.css';
	let { children } = $props<{ children: () => unknown }>();
</script>

{@render children()}
