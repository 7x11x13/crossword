// Never include response bodies or authorization headers in errors: Reddit's
// token endpoint can return credentials in a successful response.
export class UpstreamError extends Error {}

export async function fetchJson(url: string, init: RequestInit, service: string): Promise<any> {
	return (await fetchJsonResponse(url, init, service)).json;
}

export async function fetchJsonResponse(url: string, init: RequestInit, service: string) {
	let response: Response;
	try {
		response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
	} catch {
		throw new UpstreamError(`${service}: network request failed or timed out`);
	}
	const contentType = response.headers.get('content-type')?.split(';')[0] ?? 'unknown';
	const context = `${service}: HTTP ${response.status}, content-type ${contentType}`;
	if (!response.ok) {
		await response.body?.cancel();
		throw new UpstreamError(`${context}; request rejected`);
	}
	const reader = response.body?.getReader();
	if (!reader) throw new UpstreamError(`${context}; empty body`);
	try {
		// XWordInfo serves valid JSON as text/plain, so don't reject on MIME type alone.
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.length;
			if (size > 2_000_000) {
				await reader.cancel();
				throw new Error('Response too large');
			}
			chunks.push(chunk.value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
		return { json: JSON.parse(new TextDecoder().decode(bytes)), headers: response.headers };
	} catch {
		throw new UpstreamError(`${context}; expected JSON within response size and time limits`);
	} finally {
		reader.releaseLock();
	}
}
