// gakushoku.com の週替わりメニュー表を読む。
// 取得元への負荷を抑えるため、1 回の実行で同じページは 1 度しか取りに行かない（createPageLoader）。
// 取得元の方針は README の「取得元への配慮」を参照。

import { WEEKDAYS, makeDay, sameDay } from './date.js';

/** 取得対象。この 2 ページ以外にはアクセスしない */
export const SOURCE_PAGES = ['http://www.gakushoku.com/univ_mn1.php', 'http://www.gakushoku.com/univ_mn2.php'];

/** 運営者が連絡できるよう、Bot であることと連絡先（このリポジトリ）を名乗る */
export const USER_AGENT = 'gakushoku-bot/1.2 (+https://github.com/yonu33/gakushoku-bot)';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_CHARS = 512 * 1024;
const CLOSED_PATTERN = /お休み|休業/;

/** ページの構造が想定と違う（サイト改修など）ときのエラー */
export class LayoutError extends Error {
	name = 'LayoutError';
}

/**
 * URL → HTML のローダーを作る。同じ URL は 1 回だけ取得し、結果を使い回す。
 * リトライはしない（失敗したらその回は諦める）。
 */
export function createPageLoader(fetchImpl = (...args) => fetch(...args)) {
	const cache = new Map();
	return (url) => {
		if (!cache.has(url)) cache.set(url, fetchPage(url, fetchImpl));
		return cache.get(url);
	};
}

async function fetchPage(url, fetchImpl) {
	const res = await fetchImpl(url, {
		headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const html = await res.text();
	if (html.length > MAX_PAGE_CHARS) throw new LayoutError(`ページが想定より大きい (${html.length} 文字)`);
	return html;
}

/**
 * メニュー表（table.day）を読み取る。
 *
 * 表の形（実際のページより）:
 *   | 11月 第3週     | 16日（月） | 17日（火） | ... |
 *   | 日替わりランチ | ...        | ...        | ... |
 *   | 単品 / 麺類 / 魚 / サラダ ...（時期によって増減する）|
 *   | 夕食セット     | ...        | ...        | ... |   ← 長期休み中は行ごとなくなる
 *
 * @returns {{ labelMonth: number | null, columns: { index: number, day: number, weekday: number | null }[], rows: string[][] }}
 *   columns は日付の列（index は行の中での位置）、rows は見出し行以外の各行のセルのテキスト
 */
export function parseMenuTable(html) {
	const table = /<table\b[^>]*\bclass\s*=\s*["'][^"']*\bday\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i.exec(
		html.replace(/<!--[\s\S]*?-->/g, ''),
	);
	if (!table) throw new LayoutError('メニュー表 (table.day) が見つかりません');

	const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
		[...row[1].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) => textOf(cell[2])),
	);
	if (rows.length < 2) throw new LayoutError('メニュー表の行が足りません');

	const [header, ...body] = rows;
	// 0 列目は「11月 第3週」のような週の名前。日付の列と混同しないよう別に扱う
	const labelMonth = Number(/(\d{1,2})\s*月/.exec(header[0])?.[1]) || null;
	const columns = header
		.map((text, index) => {
			const weekday = /[（(]\s*([日月火水木金土])/.exec(text)?.[1];
			return { index, day: Number(/(\d{1,2})\s*日/.exec(text)?.[1]) || 0, weekday: weekday ? WEEKDAYS.indexOf(weekday) : null };
		})
		.filter((c) => c.index > 0 && c.day > 0);
	if (!columns.length) throw new LayoutError('見出し行に日付が見つかりません');

	return { labelMonth, columns, rows: body };
}

/**
 * 表から指定日・指定行のメニューを探す。
 * @param {ReturnType<typeof parseMenuTable>} table
 * @param {import('./date.js').Day} target
 * @param {string} rowLabel 行見出し（例: "日替わりランチ"）
 * @returns {{ status: 'found', menu: string } | { status: 'closed' } | { status: 'not_listed' }}
 */
export function findMenu(table, target, rowLabel) {
	const dates = resolveColumnDates(table, target);
	const column = table.columns.find((_, i) => dates[i] && sameDay(dates[i], target));
	if (!column) return { status: 'not_listed' };

	// 行は位置ではなく見出しで探す（行の数や並びは時期によって変わる）
	const row = table.rows.find((cells) => cells[0]?.includes(rowLabel));
	if (!row) {
		// 長期休み中は「夕食セット」の行ごとなくなる。ランチの行まで無いなら表の形が変わったとみなす
		if (!table.rows.some((cells) => cells[0]?.includes(ANCHOR_ROW))) throw new LayoutError(`「${rowLabel}」の行が見つかりません`);
		return { status: 'closed' };
	}

	const menu = row[column.index] ?? '';
	if (menu.length <= 1 || CLOSED_PATTERN.test(menu)) return { status: 'closed' };
	return { status: 'found', menu };
}

const ANCHOR_ROW = '日替わりランチ';

/**
 * 週見出しの「月」と各列の「日・曜日」から、各列の年月日を決める。
 * 「日」だけで照合すると、休み中に更新が止まった古いページ（例: 7/15）を別の月の同じ日（8/15）に拾ってしまう。
 *
 * 月をまたぐ週は、見出しがどちらの月になるか決まっていない（例: 「10月 第1週」に 9/29, 9/30, 10/1 ...）。
 * そこで候補（見出しの月から始まる / 前の月から始まる × 今年・前年・翌年）を作り、曜日がすべて合うものを採用する。
 * @returns {(import('./date.js').Day | null)[]} columns と同じ順の年月日
 */
function resolveColumnDates(table, around) {
	const { labelMonth, columns } = table;
	if (labelMonth === null) {
		// 月が読めないときは日と曜日だけで照合する
		return columns.map((c) => (c.day === around.day && (c.weekday === null || c.weekday === around.weekday) ? around : null));
	}

	// 週の途中で日付が小さくなる位置（例: 30日 → 1日）から先は次の月
	const wrapAt = columns.findIndex((c, i) => i > 0 && c.day < columns[i - 1].day);
	const startMonths = wrapAt === -1 ? [labelMonth] : [labelMonth, labelMonth - 1];
	for (const startMonth of startMonths) {
		for (const year of [around.year, around.year - 1, around.year + 1]) {
			const dates = columns.map((c, i) => makeDay(year, startMonth + (wrapAt !== -1 && i >= wrapAt ? 1 : 0), c.day));
			const consistent = columns.every((c, i) => dates[i].day === c.day && (c.weekday === null || c.weekday === dates[i].weekday));
			if (consistent) return dates;
		}
	}
	throw new LayoutError(`見出しの日付と曜日が合いません（${labelMonth}月: ${columns.map((c) => `${c.day}日`).join(' ')}）`);
}

/**
 * 取得対象ページを順に見て、指定日のメニューを探す。
 * status が 'error' のときは「休み」なのか「取れなかった」のか判断できない。
 * @returns {Promise<{ status: 'found' | 'closed' | 'not_listed' | 'error', menu?: string, sourceUrl?: string, errors: string[] }>}
 */
export async function lookupMenu(loadPage, target, rowLabel) {
	const errors = [];
	for (const url of SOURCE_PAGES) {
		try {
			const result = findMenu(parseMenuTable(await loadPage(url)), target, rowLabel);
			if (result.status !== 'not_listed') return { ...result, sourceUrl: url, errors };
		} catch (e) {
			errors.push(`${url}: ${e.message}`);
		}
	}
	return { status: errors.length ? 'error' : 'not_listed', errors };
}

/** HTML 断片をテキストにする。<br> は改行、行内の空白は 1 つにまとめる */
export function textOf(fragment) {
	return decodeEntities(fragment.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\n');
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, entity) => {
		if (entity[0] !== '#') return NAMED_ENTITIES[entity.toLowerCase()] ?? all;
		const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
	});
}
