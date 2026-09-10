import { createRedditSession, findRedditPoll, parseClosedPoll } from '../src/reddit';

export const sampleDates = ['07/17/2026', '07/18/2026', '07/25/2026', '08/01/2026', '08/08/2026', '08/15/2026', '08/22/2026', '08/29/2026', '09/03/2026'];

export async function probe(dates = sampleDates) {
	const startedAt = new Date().toISOString();
	try {
		const session = await createRedditSession();
		const polls = [];
		for (const date of dates) {
			const post = await findRedditPoll(session, date);
			if (!post) throw new Error(`No discussion found for ${date}`);
			polls.push({ date, title: post.title, url: post.url, ...parseClosedPoll(post.poll_data) });
		}
		return { startedAt, ok: true, polls };
	} catch (error) {
		return { startedAt, ok: false, error: error instanceof Error ? error.message : 'Unknown probe failure' };
	}
}

// Temporary remote preview only: no cron or database bindings.
export default {
	async fetch(request: Request): Promise<Response> {
		if (request.method !== 'POST' || new URL(request.url).pathname !== '/probe') return new Response('POST /probe', { status: 404 });
		const result = await probe();
		return Response.json(result, { status: result.ok ? 200 : 502, headers: { 'Cache-Control': 'no-store' } });
	},
};
