import { createRedditSession, findRedditPoll, parseClosedPoll } from '../../backend/src/reddit';
export default {
 async fetch() {
  const results=[];
  for (const date of ['2026-09-26','2026-10-28']) {
   try {
    const r=await fetch(`https://www.nytimes.com/svc/crosswords/v6/puzzle/daily/${date}.json`,{signal:AbortSignal.timeout(15000)});
    const j=await r.json();results.push({service:'NYT',date,status:r.status,publicationDate:j.publicationDate,constructors:j.constructors,editor:j.editor});
   }catch(e){results.push({service:'NYT',date,error:e.message})}
  }
  try {
   const session=await createRedditSession();
   for (const path of ['/by_id/t3_1wpk2js.json?raw_json=1','/user/Shortz-Bot/submitted?limit=100&raw_json=1']) {
    const r=await fetch('https://oauth.reddit.com'+path,{headers:session.headers});
    results.push({service:'Reddit endpoint',path,status:r.status});await r.body?.cancel();
   }
   for (const date of ['09/26/2026','10/15/2026','10/28/2026']) {
    const post=await findRedditPoll(session,date);
    if (!post) throw new Error(`Missing poll ${date}`);
    const poll=parseClosedPoll(post.poll_data);
    results.push({service:'Reddit',date,total:poll.total,validPoll:true});
   }
  } catch(e) {results.push({service:'Reddit',error:e.message})}
  return Response.json(results);
 }
};
