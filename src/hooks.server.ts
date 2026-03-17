import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { readSession } from '$lib/server/auth';
import { getAccessState } from '$lib/server/access';

const PUBLIC_PATHS = ['/auth/login', '/auth/callback', '/auth/error', '/favicon.ico'];
const UNAUTHORIZED_PATH = '/unauthorized';
const SETUP_PATH = '/setup';
const INTERNAL_JOB_PATH_PREFIX = '/api/internal/jobs/';
const DEV_API_PATH_PREFIX = '/api/dev/';

export const handle: Handle = async ({ event, resolve }) => {
    const { pathname } = event.url;
    const isDevApiPath = pathname.startsWith(DEV_API_PATH_PREFIX);

    if (pathname.startsWith(INTERNAL_JOB_PATH_PREFIX)) {
        // Internal jobs are blocked at nginx and only reachable on the internal docker network.
        return resolve(event);
    }

    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
        return resolve(event);
    }

    const session = await readSession(event);
    if (!session) {
        throw redirect(302, '/auth/login');
    }

	const access = await getAccessState(session.user.id);
	if (!isDevApiPath) {
		if (access.isBootstrap && !access.hasCharts && pathname !== SETUP_PATH) {
			throw redirect(302, SETUP_PATH);
		}
        if (!access.hasAccess && pathname !== UNAUTHORIZED_PATH) {
            throw redirect(302, UNAUTHORIZED_PATH);
        }
        if (access.hasAccess && pathname === UNAUTHORIZED_PATH) {
            throw redirect(302, '/');
        }
        if (pathname === SETUP_PATH && !access.isBootstrap) {
            throw redirect(302, '/');
        }
    }

    event.locals.user = session.user;
    return resolve(event);
};
