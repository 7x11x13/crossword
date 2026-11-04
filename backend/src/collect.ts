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

export interface PuzzleMetadata {
	print_date: string;
	author: string;
	editor: string;
}

export async function fetchPuzzleMetadata(start: Date, end: Date) {
	const params = new URLSearchParams({ publish_type: 'daily', date_start: start.toISOString().slice(0, 10), date_end: end.toISOString().slice(0, 10) });
	const json = await fetchJson(`https://www.nytimes.com/svc/crosswords/v3/puzzles.json?${params}`, {}, 'NYT metadata');
	if (json?.status !== 'OK' || !Array.isArray(json.results)) throw new Error('Invalid NYT metadata listing');
	const puzzles = new Map<string, PuzzleMetadata>();
	for (const puzzle of json.results) {
		if (puzzle.publish_type !== 'Daily' || typeof puzzle.print_date !== 'string' ||
			typeof puzzle.author !== 'string' || !puzzle.author.trim() || typeof puzzle.editor !== 'string' || !puzzle.editor.trim()) {
			throw new Error('NYT metadata missing required fields');
		}
		if (puzzles.has(puzzle.print_date)) throw new Error(`Duplicate NYT metadata for ${puzzle.print_date}`);
		puzzles.set(puzzle.print_date, puzzle);
	}
	return puzzles;
}

function getCrosswordData(date: Date, data: RedditPost, metadata: PuzzleMetadata) {
	if (metadata.print_date !== date.toISOString().slice(0, 10)) throw new Error('NYT metadata date mismatch');
	const ret = {
		publishedDate: dateToInt(date),
		dateString: getDateString(date),
		dayName: date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
		author: he.decode(metadata.author),
		editor: he.decode(metadata.editor),
		pollURL: data.url,
	};
	return ret;
}

export function collectPollData(date: Date, data: RedditPost, metadata: PuzzleMetadata) {
	// Open polls omit option counts; leave them missing until voting closes.
	const closingTime = (data.poll_data as { voting_end_timestamp?: unknown })?.voting_end_timestamp;
	if (typeof closingTime === 'number' && Number.isFinite(closingTime) && closingTime > Date.now()) return null;
	const { counts } = parseClosedPoll(data.poll_data);
	const votes = counts.Excellent + counts.Good + counts.Average + counts.Poor + counts.Terrible;
	if (!votes) throw new Error(`Poll has no rating votes for ${getDateString(date)}`);

	function toPercentage(n: number) {
		return (n / votes) * 100;
	}

	const crosswordData = getCrosswordData(date, data, metadata);
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

