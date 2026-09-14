<script lang="ts">
	let { size = 28 }: { size?: number } = $props();
</script>

<!--
	The Manticorps head mark. The site's brief pairs a small crest with live type rather than the
	full crest, because the crest's own lettering is illegible below ~64px -- and both places this
	renders (the app header and the sign-in card) already set the name in type beside it.
-->
<img
	src="/brand/mark.png"
	alt=""
	aria-hidden="true"
	class="inline-block shrink-0 object-contain"
	style="width:{size}px;height:{size}px"
/>
