import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';

interface Env {
	DB: D1Database;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const headers = new Headers({
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
		});
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			headers.set('Allow', 'GET, HEAD, OPTIONS');
			return new Response(null, { status: 405, headers });
		}
		try {
			const adapter = new PrismaD1(env.DB);
			const prisma = new PrismaClient({ adapter });
			const crosswords = await prisma.crossword.findMany({ orderBy: [{ publishedDate: 'desc' }] });
			// Cloudflare caches for a day; browsers recheck after five minutes.
			headers.set('Cache-Control', 'public, max-age=300, s-maxage=86400');
			const response = Response.json(crosswords, { headers });
			return request.method === 'HEAD' ? new Response(null, response) : response;
		} catch (error) {
			console.error(error);
			headers.set('Cache-Control', 'no-store');
			return request.method === 'HEAD'
				? new Response(null, { headers, status: 500 })
				: Response.json({}, { headers, status: 500 });

		}
	},

};
