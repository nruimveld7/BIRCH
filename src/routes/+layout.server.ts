import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		currentUserOid: locals.user?.id ?? null
	};
};
