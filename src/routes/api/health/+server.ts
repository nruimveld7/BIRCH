import { json } from '@sveltejs/kit';

export async function GET() {
	return json({
		ok: true,
		service: 'elm',
		timestamp: new Date().toISOString()
	});
}
