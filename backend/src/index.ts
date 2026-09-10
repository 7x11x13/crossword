import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';
import he from 'he';
import { fetchJson, UpstreamError } from './upstream';
import { createRedditSession, findRedditPoll, parseClosedPoll, RedditPost, RedditSession } from './reddit';

interface Env {
	DB: D1Database;
	FIRST_POLL_DATE: string;
	POLL_DURATION_DAYS: string;
}

function dateToInt(date: Date) {
	const year = date.getUTCFullYear();
	const month = date.getUTCMonth();
	const day = date.getUTCDate();
	return Date.UTC(year, month, day);
}

function intToDate(x: number) {
	return new Date(x);
}

function getDateRange(start: Date, end: Date) {
	// Get list of dates from start to end, inclusive
	const arr = [];
	const date = new Date(start);
	while (date <= end) {
		arr.push(new Date(date));
		date.setUTCDate(date.getUTCDate() + 1);
	}
	return arr;
}

async function getMissingDates(env: Env, prisma: PrismaClient, startDate: Date) {
	// Get all dates from startDate to now which we do not have
	// data for in our DB
	const now = new Date();
	now.setUTCDate(now.getUTCDate() - parseInt(env.POLL_DURATION_DAYS) + 1);
	const results = await prisma.crossword.findMany({
		select: { publishedDate: true },
		where: {
			publishedDate: {
				gte: dateToInt(startDate),
				lte: dateToInt(now),
			},
		},
	});

	const existingDates = results.map(({ publishedDate }) => publishedDate) as number[];

	const dates = getDateRange(startDate, now).map(dateToInt);
	return dates.filter(d => !existingDates.includes(d)).map(intToDate);
}

function getDateString(date: Date) {
	// return UTC date in MM/DD/yyyy format
	const dateComponents = date.toISOString().substring(0, 10).split('-');
	dateComponents.push(dateComponents.shift()!);
	return dateComponents.join('/');
}

async function getCrosswordData(date: Date, data: RedditPost) {
	const params = new URLSearchParams({
		date: getDateString(date),
		format: 'text',
	});
	const url = 'https://www.xwordinfo.com/JSON/Data.ashx?' + params.toString();
	const headers = new Headers({ Referer: 'https://www.xwordinfo.com/JSON/' });
	const json = await fetchJson(url, { headers }, 'XWordInfo metadata');
	if (typeof json?.author !== 'string' || typeof json?.editor !== 'string') {
		throw new Error(`XWordInfo metadata missing author or editor for ${getDateString(date)}`);
	}
	const ret: any = {
		publishedDate: dateToInt(date),
		dateString: getDateString(date),
		dayName: date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
		author: he.decode(json.author),
		editor: he.decode(json.editor),
	};
	ret.pollURL = data.url;
	return ret;
}

async function insertPollData(prisma: PrismaClient, date: Date, data: RedditPost) {
	// Insert poll data into our DB
	// Open polls omit option counts; leave them missing until voting closes.
	const closingTime = (data.poll_data as { voting_end_timestamp?: unknown })?.voting_end_timestamp;
	if (typeof closingTime === 'number' && Number.isFinite(closingTime) && closingTime > Date.now()) return null;
	const { counts } = parseClosedPoll(data.poll_data);
	const votes = counts.Excellent + counts.Good + counts.Average + counts.Poor + counts.Terrible;
	if (!votes) throw new Error(`Poll has no rating votes for ${getDateString(date)}`);

	function toPercentage(n: number) {
		return (n / votes) * 100;
	}

	const crosswordData = await getCrosswordData(date, data);
	return await prisma.crossword.create({
		data: {
			...crosswordData,
			pollExists: true,
			votes,
			excellent: counts.Excellent,
			good: counts.Good,
			average: counts.Average,
			poor: counts.Poor,
			terrible: counts.Terrible,
			noVote: counts['I just want to see the results'],
			excellentPercentage: toPercentage(counts.Excellent!),
			goodPercentage: toPercentage(counts.Good!),
			averagePercentage: toPercentage(counts.Average!),
			poorPercentage: toPercentage(counts.Poor!),
			terriblePercentage: toPercentage(counts.Terrible!),
			averageRating:
				(5 * counts.Excellent! +
					4 * counts.Good! +
					3 * counts.Average! +
					2 * counts.Poor! +
					1 * counts.Terrible!) /
				votes,
		},
	});
}

async function tryUpdatePollData(prisma: PrismaClient, session: RedditSession, date: Date) {
	const dateString = getDateString(date);
	const data = await findRedditPoll(session, dateString);
	if (data) {
		const inserted = await insertPollData(prisma, date, data);
		console.log(`Inserted crossword (${dateString}): ${JSON.stringify(inserted)}`);
		return;
	}
	// Search relevance/availability is not evidence that a poll never existed.
	throw new Error(`No matching discussion for ${dateString}; leaving date for retry`);
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const headers = new Headers({
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET',
		});
		try {
			const adapter = new PrismaD1(env.DB);
			const prisma = new PrismaClient({ adapter });
			const crosswords = await prisma.crossword.findMany({ orderBy: [{ publishedDate: 'desc' }] });
			return Response.json(crosswords, { headers });
		} catch (error) {
			console.error(error);
			return Response.json({}, { headers, status: 500 });

		}
	},

	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		const adapter = new PrismaD1(env.DB);
		const prisma = new PrismaClient({ adapter });
		const missing = await getMissingDates(env, prisma, new Date(env.FIRST_POLL_DATE));
		console.log(missing);
		if (!missing.length) return;
		const session = await createRedditSession();
		// Bound backfill work per cron: at most 15 Reddit, 15 metadata and 15 database writes.
		const batch = missing.slice(0, 15);
		for (const date of batch) {
			try {
				await tryUpdatePollData(prisma, session, date);
			} catch (error) {
				console.log(error);
				// Stop on shared upstream failures rather than hammering a blocked or
				// rate-limited service. These dates remain missing and will be retried.
				if (error instanceof UpstreamError) throw error;
			}
		}
	},
};
