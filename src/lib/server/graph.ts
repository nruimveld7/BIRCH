type GraphUser = {
	id: string;
	displayName?: string;
	givenName?: string;
	surname?: string;
	mail?: string;
	userPrincipalName?: string;
};

function escapeODataLiteral(value: string): string {
	return value.replace(/'/g, "''");
}

function normalizeQuery(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

function startsWithClause(field: string, value: string): string {
	return `startswith(${field},'${escapeODataLiteral(value)}')`;
}

function buildUserSearchFilter(query: string): string {
	const clauses = [
		startsWithClause('displayName', query),
		startsWithClause('userPrincipalName', query),
		startsWithClause('mail', query)
	];

	const terms = query.split(' ').filter(Boolean);
	if (terms.length >= 2) {
		const first = terms[0];
		const last = terms[terms.length - 1];
		const firstWithMiddle = terms.slice(0, -1).join(' ');
		const lastWithMiddle = terms.slice(1).join(' ');
		clauses.push(
			`(${startsWithClause('givenName', first)} and ${startsWithClause('surname', last)})`,
			`(${startsWithClause('givenName', last)} and ${startsWithClause('surname', first)})`,
			startsWithClause('displayName', `${last}, ${firstWithMiddle}`),
			startsWithClause('displayName', `${first}, ${lastWithMiddle}`)
		);
	}

	return clauses.join(' or ');
}

export async function searchTenantUsers(
	token: string,
	query: string,
	limit = 50
): Promise<GraphUser[]> {
	const normalizedQuery = normalizeQuery(query);
	if (!normalizedQuery) return [];
	const filter = buildUserSearchFilter(normalizedQuery);

	const url = new URL('https://graph.microsoft.com/v1.0/users');
	url.searchParams.set('$select', 'id,displayName,givenName,surname,mail,userPrincipalName');
	url.searchParams.set('$top', String(Math.max(1, Math.min(limit, 100))));
	url.searchParams.set('$filter', filter);

	const res = await fetch(url.toString(), {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Graph users search failed: ${res.status} ${text}`);
	}
	const data = (await res.json()) as { value: GraphUser[] };
	return data.value ?? [];
}

export async function listTenantUsers(token: string): Promise<GraphUser[]> {
	const users: GraphUser[] = [];

	let nextUrl =
		'https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName&$top=999';
	let pages = 0;

	while (nextUrl && pages < 10) {
		const res = await fetch(nextUrl, {
			headers: { Authorization: `Bearer ${token}` }
		});

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Graph users request failed: ${res.status} ${text}`);
		}

		const data = (await res.json()) as {
			value: GraphUser[];
			'@odata.nextLink'?: string;
		};

		users.push(...data.value);
		nextUrl = data['@odata.nextLink'] ?? '';
		pages += 1;
	}

	return users;
}
