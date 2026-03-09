import type { RequestHandler } from './$types';
import { isHttpError, redirect } from '@sveltejs/kit';
import { finishLogin } from '$lib/server/auth';

function classifyAuthFailure(message: string): string {
	if (message.includes('Invalid state')) return 'invalid_state';
	if (message.includes('Missing auth state')) return 'missing_auth_state';
	if (message.includes('Invalid nonce')) return 'invalid_nonce';
	if (message.includes('OIDC error')) return 'oidc_error';
	return 'callback_failed';
}

export const GET: RequestHandler = async (event) => {
	try {
		await finishLogin(event);
		throw redirect(302, '/');
	} catch (err) {
		if (!isHttpError(err)) {
			throw err;
		}

		const bodyMessage =
			typeof err.body === 'object' && err.body && 'message' in err.body
				? String((err.body as { message?: string }).message ?? '')
				: '';
		const reason = classifyAuthFailure(bodyMessage || 'callback_failed');
		const params = new URLSearchParams({
			reason,
			status: String(err.status)
		});
		throw redirect(302, `/auth/error?${params.toString()}`);
	}
};
