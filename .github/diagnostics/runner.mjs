import worker from './worker-bundle.mjs';
console.log(JSON.stringify(await (await worker.fetch()).json(),null,2));
