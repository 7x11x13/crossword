import { createRedditSession, findRedditPoll } from '../src/reddit.ts';
import { collectPollData } from '../src/collect.ts';
import { fetchJson, UpstreamError } from '../src/upstream.ts';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('Cloudflare account and token are required');
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/d3e2c556-85f7-41c6-970e-f6db9b486edf/query`;
async function query(sql, params = []) {
 const result = await fetchJson(endpoint, {
  method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
  body: JSON.stringify({sql, params}),
 }, 'D1');
 if (!result.success || !Array.isArray(result.result) || result.result.some(r => !r.success)) throw new Error('D1 query failed');
 return result.result[0].results;
}
const existing = new Set((await query('SELECT publishedDate FROM Crossword')).map(r => r.publishedDate));
const missing = [];
const end = new Date(); end.setUTCDate(end.getUTCDate() - 6);
for (let date = new Date('2020-11-27T00:00:00Z'); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
 if (!existing.has(date.getTime())) missing.push(new Date(date));
}
console.log(JSON.stringify({missing: missing.length, dryRun: process.argv.includes('--dry-run')}));
if (missing.length) {
 const session = await createRedditSession();
 let failed = 0;
 // Bound one run while allowing the current backlog to be recovered in one pass.
 for (const date of missing.slice(0, 60)) {
  const iso = date.toISOString().slice(0,10);
  const key = `${iso.slice(5,7)}/${iso.slice(8,10)}/${iso.slice(0,4)}`;
  try {
   const post = await findRedditPoll(session, key);
   if (!post) throw new Error('No matching discussion');
   const row = await collectPollData(date, post);
   if (!row) { console.log(`${key}: voting still open`); continue; }
   if (!process.argv.includes('--dry-run')) {
    const columns = Object.keys(row);
    await query(`INSERT INTO Crossword (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(publishedDate) DO NOTHING`, Object.values(row).map(v => typeof v === 'boolean' ? Number(v) : v));
   }
   console.log(JSON.stringify({date:key,status:process.argv.includes('--dry-run')?'validated':'saved',votes:row.votes,author:row.author,editor:row.editor}));
  } catch (error) {
   failed++;
   console.error(`${key}: ${error.message}`);
   if (error instanceof UpstreamError && !error.message.includes('HTTP 404')) break;
  }
 }
 if (failed) process.exitCode = 1;
}
