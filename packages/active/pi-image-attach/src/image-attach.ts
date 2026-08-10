import {
	existsSync,
	readFileSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import {
	extname,
	isAbsolute,
	join,
	resolve,
} from "node:path";
import {
	convertToPng,
	resizeImage,
	type ExtensionAPI,
	type ImageContent,
} from "@earendil-works/pi-coding-agent";

const IMAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".gif", "image/gif"],
	[".webp", "image/webp"],
	[".bmp", "image/bmp"],
	[".heic", "image/heic"],
	[".heif", "image/heif"],
	[".avif", "image/avif"],
	[".tif", "image/tiff"],
	[".tiff", "image/tiff"],
	[".ico", "image/x-icon"],
]);

// Formats that providers accept inline without conversion.
const NATIVE_INLINE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// Codex-like label color (bright blue).
const IMAGE_LABEL_STYLE = "\x1b[38;5;75m";
const RESET = "\x1b[0m";

const LABEL_PATTERN = /🖼 Image \d+/g;

export default function imageAttach(pi: ExtensionAPI) {
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };

		const candidates = parseImagePathLines(event.text, ctx.cwd);
		if (candidates.length === 0) return { action: "continue" };

		const images: ImageContent[] = [];
		const replacements = new Map<number, string>();
		let imageNumber = 1;
		for (const candidate of candidates) {
			const block = await readImageBlock(candidate.path);
			if (!block) continue;
			images.push(block);
			replacements.set(candidate.start, { candidate, label: `🖼 Image ${imageNumber}` });
			imageNumber += 1;
		}

		if (images.length === 0) return { action: "continue" };

		const text = applySpans(event.text, replacements);
		return {
			action: "transform",
			text,
			images: [...(event.images ?? []), ...images],
		};
	});

	pi.registerMarkdownTransformer((markdown, { messageType, isStreaming }) => {
		if (messageType !== "user" || isStreaming) return markdown;
		return markdown.replace(LABEL_PATTERN, (label) => `${IMAGE_LABEL_STYLE}${label}${RESET}`);
	});
}

const TRAILING_PUNCTUATION = /[\s,;.!?…:)]+$/;
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif|tiff?|ico)$/i;
const SEPARATOR_PATTERN = /[\/\\]|^(~|\.(\.)?)\/?/;

interface ImagePathCandidate {
	path: string;
	start: number;
	end: number;
}

function applySpans(text: string, replacements: Map<number, { candidate: ImagePathCandidate; label: string }>): string {
	if (replacements.size === 0) return text;
	const spans = [...replacements.values()]
		.map(({ candidate, label }) => ({ start: candidate.start, end: candidate.end, label }))
		.sort((left, right) => left.start - right.start);
	let result = "";
	let cursor = 0;
	for (const span of spans) {
		if (span.start < cursor) continue; // overlapping (quoted + bare) — keep the first
		result += text.slice(cursor, span.start) + span.label;
		cursor = span.end;
	}
	result += text.slice(cursor);
	return result;
}

function parseImagePathLines(text: string, cwd: string): ImagePathCandidate[] {
	const candidates: ImagePathCandidate[] = [];
	const lines = text.split("\n");
	let lineStart = 0;
	for (const line of lines) {
		// Quoted path tokens (Finder/terminal quote paths with spaces).
		for (const match of line.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) {
			if (match.index === undefined) continue;
			const rawToken = match[0];
			const inner = match[1] ?? match[2] ?? "";
			const path = resolveImagePath(inner, cwd);
			if (path) candidates.push({ path, start: lineStart + match.index, end: lineStart + match.index + rawToken.length });
		}
		// Bare path tokens ending in an image extension. Backslash-escaped
		// characters (e.g. `Screenshot\ 1.png`) stay inside the token.
		for (const match of line.matchAll(/(?:[^\s"'`\\]|\\.)+/g)) {
			if (match.index === undefined) continue;
			const rawToken = match[0];
			const unescaped = rawToken.replace(/\\(.)/g, "$1");
			const token = unescaped.replace(TRAILING_PUNCTUATION, "");
			if (unescaped !== rawToken && token === "") continue;
			if (!IMAGE_EXT_PATTERN.test(token)) continue;
			// Require a path separator when pasted inline, otherwise require existence in cwd.
			const pathLike = SEPARATOR_PATTERN.test(token) || /^\./i.test(token) || isAbsolute(token);
			const path = resolveImagePath(token, cwd, pathLike ? "any" : "cwd-only");
			if (path) candidates.push({ path, start: lineStart + match.index, end: lineStart + match.index + rawToken.length });
		}
		lineStart += line.length + 1;
	}
	return candidates;
}

function resolveImagePath(candidate: string, cwd: string, scope: "any" | "cwd-only" = "any"): string | undefined {
	const expanded = candidate.startsWith("~/")
		? join(homedir(), candidate.slice(2))
		: candidate;
	const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
	if (scope === "cwd-only" && !isAbsolute(expanded) && !candidate.startsWith("./")) return undefined;
	try {
		if (!existsSync(absolute)) return undefined;
		const stats = statSync(absolute);
		if (!stats.isFile() || !looksLikeImage(absolute)) return undefined;
		return absolute;
	} catch {
		return undefined;
	}
}

function looksLikeImage(path: string) {
	return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

async function readImageBlock(path: string): Promise<ImageContent | undefined> {
	try {
		const bytes = readFileSync(path);
		const mimeType = IMAGE_EXTENSIONS.get(extname(path).toLowerCase());
		if (!mimeType) return undefined;

		if (NATIVE_INLINE_MIME_TYPES.has(mimeType)) {
			const resized = await resizeImage(bytes, mimeType);
			if (resized) {
				return { type: "image", data: resized.data, mimeType: resized.mimeType };
			}
			return { type: "image", data: bytes.toString("base64"), mimeType };
		}

		// Convert non-inline formats (bmp/heic/avif/tiff/ico) to PNG.
		const png = await convertToPng(bytes.toString("base64"), mimeType);
		if (png) {
			const resized = await resizeImage(Buffer.from(png.data, "base64"), png.mimeType);
			if (resized) {
				return { type: "image", data: resized.data, mimeType: resized.mimeType };
			}
			return { type: "image", data: png.data, mimeType: png.mimeType };
		}
		return undefined;
	} catch {
		return undefined;
	}
}