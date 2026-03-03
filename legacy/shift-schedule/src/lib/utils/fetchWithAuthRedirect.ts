export async function fetchWithAuthRedirect(
	input: RequestInfo | URL,
	init: RequestInit = {},
	_basePath = ''
): Promise<Response> {
	return fetch(input, init);
}
