import ts from 'typescript';
import { readFile } from 'node:fs/promises';

async function compile(url) {
  const source = await readFile(url, 'utf8');
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  for (const match of [...outputText.matchAll(/from ['"](\.[^'"]+)['"]/g)]) {
    const dependency = await compile(new URL(`${match[1]}.ts`, url));
    outputText = outputText.replace(match[0], `from '${dependency}'`);
  }
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const { probe } = await import(await compile(new URL('./reddit-probe.ts', import.meta.url)));
const dates = process.argv.slice(2);
const result = await probe(dates.length ? dates : undefined);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
