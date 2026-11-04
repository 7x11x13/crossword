// Fetch-only anonymous mobile protocol described by Redlib:
// https://github.com/redlib-org/redlib/blob/main/src/oauth.rs
// These public client identifiers are not this application's credentials.
import { fetchJson, fetchJsonResponse, UpstreamError } from './upstream';

type Json = Record<string, unknown>;
const record = (value: unknown): Json =>
	value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const labels = ['Excellent', 'Good', 'Average', 'Poor', 'Terrible', 'I just want to see the results'];

export async function createRedditSession() {
	const device = crypto.randomUUID();
	const headers = new Headers({ Accept: 'application/json' });

	const url = 'https://www.reddit.com/auth/v2/oauth/access-token/loid';
	headers.set('Authorization', `Basic ${btoa('ohXpoqrZYub1kg:')}`);
	headers.set('User-Agent', 'Reddit/Version 2024.22.1/Build 1652272/Android 13');
	headers.set('Content-Type', 'application/json; charset=UTF-8');
	headers.set('client-vendor-id', device);
	headers.set('X-Reddit-Device-Id', device);
	headers.set('x-reddit-retry', 'algo=no-retries');
	headers.set('x-reddit-compression', '1');
	headers.set('x-reddit-qos', '10.000');
	headers.set('x-reddit-media-codecs', 'available-codecs=video/avc, video/hevc');
	const body = JSON.stringify({ scopes: ['*', 'email', 'pii'] });
	const result = await fetchJsonResponse(url, { method: 'POST', headers, body }, 'Reddit authentication');
	const token = record(result.json);
	if (typeof token.access_token !== 'string' || !token.access_token.trim() ||
		typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 30) {
		throw new UpstreamError('Reddit authentication: missing token or expiry');
	}
	headers.set('Authorization', `Bearer ${token.access_token}`);
	for (const name of ['x-reddit-loid', 'x-reddit-session']) {
		const value = result.headers.get(name);
		if (value) headers.set(name, value);
	}
	return {
		headers, expiresAt: Date.now() + (token.expires_in - 30) * 1000,
		pages: [] as Json[][], after: undefined as string | null | undefined,
	};
}

export function parseClosedPoll(value: unknown, now = Date.now()) {
	const poll = record(value);
	if (typeof poll.voting_end_timestamp !== 'number' || !Number.isFinite(poll.voting_end_timestamp) || poll.voting_end_timestamp <= 0 || poll.voting_end_timestamp > now) throw new Error('Poll is open or has invalid closing time');
	if (!Array.isArray(poll.options) || poll.options.length !== labels.length) throw new Error('Expected six poll options');
	const counts: Record<string, number> = {};
	for (const option of poll.options) {
		const { text, vote_count } = record(option);
		if (typeof text !== 'string' || !labels.includes(text) || text in counts || typeof vote_count !== 'number' || !Number.isSafeInteger(vote_count) || vote_count < 0) throw new Error('Missing or invalid option counts');
		counts[text] = vote_count;
	}
	const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
	if (!Number.isSafeInteger(total) || total !== poll.total_vote_count) throw new Error('Poll total differs from option counts');
	return { counts, total, closesAt: poll.voting_end_timestamp };
}

export type RedditSession = Awaited<ReturnType<typeof createRedditSession>>;

export interface RedditPost {
	title: string;
	url: string;
	poll_data: unknown;
}

export async function findRedditPoll(session: RedditSession, date: string): Promise<RedditPost | null> {
	if (Date.now() >= session.expiresAt) throw new UpstreamError('Reddit session expired; retry next run');
	// Reuse listing pages for every date in this cron run. Bound pagination to
	// Reddit's recent submission history; absent dates remain eligible for retry.
	for (let page = 0; page < 10; page++) {
		if (!session.pages[page]) {
			if (session.after === null) break;
			const query = new URLSearchParams({ sort: 'new', limit: '100', raw_json: '1' });
			if (session.after) query.set('after', session.after);
			const json = await fetchJson(`https://oauth.reddit.com/user/Shortz-Bot/submitted.json?${query}`, { headers: session.headers }, 'Reddit submissions');
			const listing = record(record(json).data);
			if (!Array.isArray(listing.children) || (listing.after !== null && typeof listing.after !== 'string')) {
				throw new UpstreamError('Reddit submissions: response did not contain a valid listing');
			}
			const posts = listing.children.map(child => record(record(child).data));
			if (posts.some(post => typeof post.author !== 'string' || typeof post.title !== 'string' || typeof post.subreddit !== 'string')) {
				throw new UpstreamError('Reddit submissions: malformed listing entry');
			}
			if (listing.after && listing.after === session.after) throw new UpstreamError('Reddit submissions: repeated pagination cursor');
			session.pages.push(posts);
			session.after = listing.after as string | null;
		}
		const matches: RedditPost[] = [];
		for (const post of session.pages[page]) {
			if (post.author !== 'Shortz-Bot' || post.subreddit !== 'crossword' || typeof post.title !== 'string' || !post.title.startsWith('NYT') || !post.title.endsWith(`${date} Discussion`)) continue;
			if (typeof post.url !== 'string' || !post.url.startsWith('https://www.reddit.com/')) throw new Error(`Invalid poll URL for ${date}`);
			if (!post.poll_data) throw new Error(`Discussion is missing poll data for ${date}`);
			matches.push({ title: post.title, url: post.url, poll_data: post.poll_data });
		}
		if (matches.length > 1) {
			// The bot occasionally publishes the same daily discussion twice. Use
			// the closed poll with the most participation, never combine its votes.
			const ranked = matches.map(post => ({ post, total: parseClosedPoll(post.poll_data).total }))
				.sort((a, b) => b.total - a.total);
			if (ranked[0].total === ranked[1].total) throw new Error(`Ambiguous duplicate discussions for ${date}`);
			console.log(`Duplicate discussions for ${date}; selected ${ranked[0].post.url} (${ranked[0].total} votes)`);
			return ranked[0].post;
		}
		if (matches.length) return matches[0];
	}
	return null;
}
