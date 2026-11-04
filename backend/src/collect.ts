import he from 'he';
import { fetchJson } from './upstream';
import { parseClosedPoll, RedditPost } from './reddit';

function dateToInt(date: Date) {
	const year = date.getUTCFullYear();
	const month = date.getUTCMonth();
	const day = date.getUTCDate();
	return Date.UTC(year, month, day);
}

function getDateString(date: Date) {
	// return UTC date in MM/DD/yyyy format
	const dateComponents = date.toISOString().substring(0, 10).split('-');
	dateComponents.push(dateComponents.shift()!);
	return dateComponents.join('/');
}

async function getCrosswordData(date: Date, data: RedditPost) {
	const publicationDate = date.toISOString().slice(0, 10);
	const json = await fetchJson(`https://www.nytimes.com/svc/crosswords/v6/puzzle/daily/${publicationDate}.json`, {}, 'NYT metadata');
	if (json?.publicationDate !== publicationDate || !Array.isArray(json.constructors) || !json.constructors.length ||
		json.constructors.some((name: unknown) => typeof name !== 'string' || !name.trim()) ||
		typeof json.editor !== 'string' || !json.editor.trim()) {
		throw new Error(`NYT metadata missing or mismatched for ${getDateString(date)}`);
	}
	const ret = {
		publishedDate: dateToInt(date),
		dateString: getDateString(date),
		dayName: date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
		author: he.decode(json.constructors.join(' and ')),
		editor: he.decode(json.editor),
		pollURL: data.url,
	};
	return ret;
}

export async function collectPollData(date: Date, data: RedditPost) {
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
	return {
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
	};
}

