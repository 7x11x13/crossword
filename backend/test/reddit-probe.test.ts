import { afterEach, expect, it, vi } from 'vitest';
import { parseClosedPoll, createRedditSession, findRedditPoll } from '../src/reddit';
import { probe } from '../experiments/reddit-probe';

const options = ['Excellent', 'Good', 'Average', 'Poor', 'Terrible', 'I just want to see the results']
	.map((text, i) => ({ text, vote_count: [125, 261, 61, 15, 4, 95][i] }));
const poll = () => ({ voting_end_timestamp: 1, total_vote_count: 561, options: structuredClone(options) });
afterEach(() => vi.unstubAllGlobals());

it('keeps all six exact counts including non-rating votes', () => {
	expect(parseClosedPoll(poll())).toEqual({ closesAt: 1, total: 561, counts: Object.fromEntries(options.map(o => [o.text, o.vote_count])) });
});

it('rejects unavailable counts, duplicates, mismatched totals, and open polls', () => {
	const missing = poll();
	delete (missing.options[0] as { vote_count?: number }).vote_count;
	expect(() => parseClosedPoll(missing)).toThrow();
	const duplicate = poll(); duplicate.options[0].text = 'Good';
	expect(() => parseClosedPoll(duplicate)).toThrow();
	expect(() => parseClosedPoll({ ...poll(), total_vote_count: 560 })).toThrow();
	expect(() => parseClosedPoll({ ...poll(), voting_end_timestamp: Date.now() + 60000 })).toThrow();
});

it('stops after an auth rejection without leaking the response body', async () => {
	const fetch = vi.fn().mockResolvedValue(new Response('sensitive body', { status: 403, headers: { 'Content-Type': 'text/html' } }));
	vi.stubGlobal('fetch', fetch);
	const result = await probe();
	expect(result.ok).toBe(false);
	expect(JSON.stringify(result)).toContain('HTTP 403');
	expect(JSON.stringify(result)).not.toContain('sensitive body');
	expect(fetch).toHaveBeenCalledTimes(1);
});

it('fetches a closed poll with a fresh anonymous token without returning that token', async () => {
	const fetch = vi.fn()
		.mockResolvedValueOnce(Response.json({ access_token: 'test-secret-token', expires_in: 3600 }))
		.mockResolvedValueOnce(Response.json({ data: { children: [{ data: { author: 'AutoModerator', title: 'NYT Friday 07/17/2026 Discussion', url: 'https://www.reddit.com/r/crossword/comments/example', poll_data: poll() } }] } }));
	vi.stubGlobal('fetch', fetch);
	const result = await probe(['07/17/2026']);
	expect(result.ok).toBe(true);
	expect(JSON.stringify(result)).not.toContain('test-secret-token');
	expect(fetch.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer test-secret-token');
});

it('rejects successful HTTP responses without a usable token', async () => {
	const fetch = vi.fn().mockResolvedValue(Response.json({ error: 'invalid_client' }));
	vi.stubGlobal('fetch', fetch);
	expect((await probe()).ok).toBe(false);
	expect(fetch).toHaveBeenCalledTimes(1);
});

it('preserves anonymous session headers and stops before using an expired token', async () => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ access_token: 'token', expires_in: 3600 }, {
		headers: { 'x-reddit-loid': 'loid', 'x-reddit-session': 'session' },
	})));
	const session = await createRedditSession();
	expect(session.headers.get('x-reddit-loid')).toBe('loid');
	expect(session.headers.get('x-reddit-session')).toBe('session');
	session.expiresAt = 0;
	await expect(findRedditPoll(session, '07/18/2026')).rejects.toThrow('expired');
	expect(fetch).toHaveBeenCalledTimes(1);
});
