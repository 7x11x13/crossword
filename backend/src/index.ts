import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';
import he from 'he';

interface Env {
	DB: D1Database;
	FIRST_POLL_DATE: string;
	POLL_DURATION_DAYS: string;
	USER_AGENT: string;
	REDDIT_USERNAME: string;
	REDDIT_PASSWORD: string;
	REDDIT_CLIENT_ID: string;
	REDDIT_CLIENT_SECRET: string;
}

interface PollOption {
	text: string;
	vote_count: number;
	id: string;
}

interface PollData {
	voting_end_timestamp: number;
	total_vote_count: number;
	options: PollOption[];
}

interface ListingData {
	author: string;
	title: string;
	poll_data: PollData;
	url: string;
}

interface Listing {
	kind: string;
	data: ListingData;
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

async function getAccessToken(env: Env): Promise<string> {
	const body = new FormData();
	body.append('grant_type', 'password');
	body.append('username', env.REDDIT_USERNAME);
	body.append('password', env.REDDIT_PASSWORD);
	const headers = new Headers({
		'Authorization': 'Basic ' + btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`),
		'User-Agent': env.USER_AGENT,
	});
	const url = 'https://www.reddit.com/api/v1/access_token';
	const response = await fetch(url, { method: 'POST', headers, body });
	const json = (await response.json()) as any;
	return json.access_token;
}

function getDateString(date: Date) {
	// return UTC date in MM/DD/yyyy format
	const dateComponents = date.toISOString().substring(0, 10).split('-');
	dateComponents.push(dateComponents.shift()!);
	return dateComponents.join('/');
}

async function getCrosswordData(date: Date, data: ListingData | null) {
	const params = new URLSearchParams({
		date: getDateString(date),
		format: 'text',
	});
	const url = 'https://www.xwordinfo.com/JSON/Data.ashx?' + params.toString();
	const headers = new Headers({ Referer: 'https://www.xwordinfo.com/JSON/' });
	const response = await fetch(url, { headers });
	const json: any = await response.json();
	const ret: any = {
		publishedDate: dateToInt(date),
		dateString: getDateString(date),
		dayName: date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
		author: he.decode(json.author),
		editor: he.decode(json.editor),
	};
	if (data !== null) {
		ret.pollURL = data.url;
	}
	return ret;
}

async function insertPollData(prisma: PrismaClient, date: Date, data: ListingData | null) {
	// Insert poll data into our DB
	const crosswordData = await getCrosswordData(date, data);
	if (data === null) {
		return await prisma.crossword.create({
			data: {
				...crosswordData,
				pollExists: false,
			},
		});
	}

	const pollData = data.poll_data;

	if (pollData.voting_end_timestamp > Date.now()) {
		// Voting hasn't ended yet
		return null;
	}

	if (pollData.options.length !== 6) {
		throw new Error(`Unexpected number of options (${pollData.options.length}) for poll: ${date}`);
	}

	let counts: Record<string, number | undefined> = {};
	counts = pollData.options.reduce((map, obj) => ((map[obj.text] = obj.vote_count), map), counts);

	const answerCounts = [
		counts.Excellent,
		counts.Good,
		counts.Average,
		counts.Poor,
		counts.Terrible,
		counts['I just want to see the results'],
	];

	if (answerCounts.includes(undefined)) {
		throw new Error(`Unexpected options for poll: ${date}`);
	}

	const votes = answerCounts.slice(0, -1).reduce((s, v) => s! + v!, 0)!;

	function toPercentage(n: number) {
		return (n / votes) * 100;
	}

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

async function tryUpdatePollData(env: Env, prisma: PrismaClient, accessToken: string, date: Date) {
	// Try to get poll data for the given date from r/crossword
	// and insert it into our DB
	const dateString = getDateString(date);
	const query = encodeURIComponent(`NYT ${dateString} Discussion`);
	const url = `https://oauth.reddit.com/r/crossword/search.json?q=${query}&sort=relevance&restrict_sr=on&limit=5`;
	const headers = new Headers({
		'Authorization': 'bearer ' + accessToken,
		'User-Agent': env.USER_AGENT,
	});
	const response = await fetch(url, { headers });
	const json = (await response.json()) as any;
	for (const listing of json.data.children as Listing[]) {
		const data = listing.data;
		if (
			(data.author === 'AutoModerator' || data.author === 'oakgrove') &&
			data.title.startsWith('NYT') &&
			data.title.endsWith(`${dateString} Discussion`) &&
			data.poll_data
		) {
			try {
				const inserted = await insertPollData(prisma, date, data);
				console.log(`Inserted crossword (${dateString}): ${JSON.stringify(inserted)}`);
			} catch (e) {
				console.log(e);
			}
			return;
		}
	}
	// if we cant find the poll for 2 weeks ago,
	// we probably wont ever be able to find it
	// so we insert a null poll
	const notExistsCutoff = new Date();
	notExistsCutoff.setUTCDate(notExistsCutoff.getUTCDate() - parseInt(env.POLL_DURATION_DAYS) * 2);
	if (date < notExistsCutoff) {
		const inserted = await insertPollData(prisma, date, null);
		console.log(`Inserted crossword (${dateString}): ${JSON.stringify(inserted)}`);
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const adapter = new PrismaD1(env.DB);
		const prisma = new PrismaClient({ adapter });
		const crosswords = await prisma.crossword.findMany({ orderBy: [{ publishedDate: 'desc' }] });
		const headers = new Headers({
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET',
		});
		return Response.json(crosswords, { headers });
	},

	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		const adapter = new PrismaD1(env.DB);
		const prisma = new PrismaClient({ adapter });
		const missing = await getMissingDates(env, prisma, new Date(env.FIRST_POLL_DATE));
		console.log(missing);
		const accessToken = await getAccessToken(env);
		for (const date of missing) {
			await tryUpdatePollData(env, prisma, accessToken, date);
		}
	},
};
