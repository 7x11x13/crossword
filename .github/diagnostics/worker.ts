import { createRedditSession, findRedditPoll, parseClosedPoll } from '../../backend/src/reddit';
export default {
 async fetch() {
  const results=[];
  for (const date of ['09/25/2026','09/26/2026','10/28/2026']) {
   try {
    const params=new URLSearchParams({date,format:'text'});
    const r=await fetch(`https://www.xwordinfo.com/JSON/Data.ashx?${params}`,{headers:{Referer:'https://www.xwordinfo.com/JSON/'},redirect:'manual',signal:AbortSignal.timeout(15000)});
    const body=await r.text();let data;try{data=JSON.parse(body)}catch{}
    results.push({date,status:r.status,contentType:r.headers.get('content-type'),cloudflareBlock:body.includes('Attention Required! | Cloudflare'),validMetadata:typeof data?.author==='string'&&typeof data?.editor==='string'});
   } catch(e) {results.push({date,error:e.message})}
  }
  try {
   const session=await createRedditSession();
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
