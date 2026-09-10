import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ crossword: { findMany: vi.fn(), create: vi.fn() } }));
vi.mock('@prisma/client', () => ({ PrismaClient: class { constructor() { return db; } } }));
vi.mock('@prisma/adapter-d1', () => ({ PrismaD1: class {} }));
import worker from '../src/index';
import { fetchJson } from '../src/upstream';

const env = {
	DB: {} as D1Database, FIRST_POLL_DATE: '2026-07-18', POLL_DURATION_DAYS: '7',
};
const run = () => worker.scheduled({} as ScheduledEvent, env, {} as ExecutionContext);
const json = (body: unknown) => Response.json(body);
const poll = (day: string, options = ['Excellent', 'Good', 'Average', 'Poor', 'Terrible', 'I just want to see the results']) => json({
	data: { children: [{ data: {
		author: 'AutoModerator', title: `NYT Saturday ${day} Discussion`, url: 'https://www.reddit.com/poll',
		poll_data: { voting_end_timestamp: 1, total_vote_count: options.length, options: options.map(text => ({ text, vote_count: 1 })) },
	} }] },
});

beforeEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-09-09T03:00:00Z'));
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.stubGlobal('fetch', vi.fn());
	// Only these two historical dates are missing, regardless of when tests run.
	const dates = [];
	for (let day = new Date('2026-07-20'); day < new Date('2026-09-04'); day.setUTCDate(day.getUTCDate() + 1)) {
		dates.push({ publishedDate: day.getTime() });
	}
	db.crossword.findMany.mockResolvedValue(dates);
	db.crossword.create.mockImplementation(async ({ data }) => data);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('upstream responses', () => {
	it('reports a Reddit HTML rejection without leaking its body', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('<!doctype html>private-response', { status: 403, headers: { 'content-type': 'text/html' } }));
		await expect(fetchJson('https://oauth.reddit.com/search', {}, 'Reddit search'))
			.rejects.toThrow('Reddit search: HTTP 403, content-type text/html; request rejected');
	});
	it('reports HTML even when the HTTP status is successful', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }));
		await expect(fetchJson('https://oauth.reddit.com/search', {}, 'Reddit search'))
			.rejects.toThrow('HTTP 200, content-type text/html; expected JSON');
	});
	it('accepts XWordInfo JSON served as text/plain', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('{"author":"Example"}', { headers: { 'content-type': 'text/plain' } }));
		await expect(fetchJson('https://www.xwordinfo.com/', {}, 'XWordInfo')).resolves.toEqual({ author: 'Example' });
	});
});

describe('scheduled updates', () => {
	it('uses one anonymous session to insert both dates without any Reddit account secrets', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
			.mockResolvedValueOnce(poll('07/18/2026'))
			.mockResolvedValueOnce(json({ author: 'Author', editor: 'Editor' }))
			.mockResolvedValueOnce(poll('07/19/2026'))
			.mockResolvedValueOnce(json({ author: 'Author', editor: 'Editor' }));
		await run();
		expect(db.crossword.create).toHaveBeenCalledTimes(2);
		const calls = vi.mocked(fetch).mock.calls;
		expect(calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
		for (const index of [1, 3]) {
			expect(new Headers(calls[index][1]?.headers).get('Authorization')).toBe('Bearer token');
			expect(calls[index][1]?.redirect).toBe('manual');
		}
		expect(new URL(String(calls[1][0])).searchParams.get('q')).toBe('title:"07/18/2026" AND title:NYT AND title:Discussion');
		expect(db.crossword.create).toHaveBeenCalledWith({ data: expect.objectContaining({ votes: 5, noVote: 1, averageRating: 3 }) });
	});
	it('leaves unsuccessful searches missing even after two weeks', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
			.mockImplementation(async () => json({ data: { children: [] } }));
		await expect(run()).rejects.toThrow('failed for 2 date(s)');
		expect(db.crossword.create).not.toHaveBeenCalled();
	});
	it('leaves open polls pending without requesting metadata or writing', async () => {
		const open = await poll('07/18/2026').json();
		open.data.children[0].data.poll_data = { voting_end_timestamp: Date.now() + 60000 };
		vi.mocked(fetch).mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
			.mockResolvedValueOnce(json(open)).mockResolvedValueOnce(poll('07/19/2026'))
			.mockResolvedValueOnce(json({ author: 'Author', editor: 'Editor' }));
		await run();
		expect(fetch).toHaveBeenCalledTimes(4);
		expect(db.crossword.create).toHaveBeenCalledTimes(1);
		expect(console.log).toHaveBeenCalledWith({ event: 'poll_pending', date: '07/18/2026' });
	});
	it('skips authentication when no dates are missing', async () => {
		await worker.scheduled({} as ScheduledEvent, { ...env, FIRST_POLL_DATE: '2026-09-10' }, {} as ExecutionContext);
		expect(fetch).not.toHaveBeenCalled();
	});
	it('limits a backfill to 15 dates in one run', async () => {
		db.crossword.findMany.mockResolvedValue([]);
		vi.mocked(fetch).mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
			.mockImplementation(async () => json({ data: { children: [] } }));
		await expect(run()).rejects.toThrow('failed for 15 date(s)');
		expect(fetch).toHaveBeenCalledTimes(16);
	});
	it('stops without writes when anonymous authentication returns HTTP 401', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('{"error":401}', {
			status: 401, headers: { 'content-type': 'application/json' },
		}));
		await expect(run()).rejects.toThrow('Reddit authentication: HTTP 401, content-type application/json; request rejected');
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://www.reddit.com/auth/v2/oauth/access-token/loid');
		expect(db.crossword.create).not.toHaveBeenCalled();
	});
	it('does not search or write when authentication returns no token', async () => {
		vi.mocked(fetch).mockResolvedValue(json({ error: 'invalid_grant' }));
		await expect(run()).rejects.toThrow('missing token or expiry');
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(db.crossword.create).not.toHaveBeenCalled();
	});
	it('stops on a Reddit block without permanently marking missing polls absent', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
			.mockResolvedValueOnce(new Response('<!doctype html>', { status: 403 }));
		await expect(run()).rejects.toThrow('Reddit search: HTTP 403');
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(db.crossword.create).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ date: '07/18/2026', event: 'poll_update_failed' }));
	});
	it('rejects malformed listings instead of treating them as absent polls', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 })).mockResolvedValueOnce(json({ error: 'denied' }));
		await expect(run()).rejects.toThrow('did not contain a listing');
		expect(db.crossword.create).not.toHaveBeenCalled();
	});
	it('continues after one malformed poll and still marks the run failed', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
			.mockResolvedValueOnce(poll('07/18/2026', ['Unexpected']))
			.mockResolvedValueOnce(poll('07/19/2026'))
			.mockResolvedValueOnce(json({ author: 'Author', editor: 'Editor' }));
		await expect(run()).rejects.toThrow('failed for 1 date(s)');
		expect(db.crossword.create).toHaveBeenCalledTimes(1);
		expect(db.crossword.create).toHaveBeenCalledWith({ data: expect.objectContaining({ dateString: '07/19/2026', pollExists: true, votes: 5 }) });
	});
});
