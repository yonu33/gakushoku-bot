// 日付はすべて日本時間の「暦日」として扱う。
// Workers のタイムゾーンは UTC なので、+9 時間ずらした Date を getUTC* で読む。

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** @typedef {{ year: number, month: number, day: number, weekday: number }} Day */

/** @returns {Day} */
function fromUtc(t) {
	return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), weekday: t.getUTCDay() };
}

/** 年月日から暦日を作る（月・日のはみ出しは繰り上がる。例: 0 月 → 前年 12 月） */
export function makeDay(year, month, day) {
	return fromUtc(new Date(Date.UTC(year, month - 1, day)));
}

/** @param {Day} a @param {Day} b */
export function sameDay(a, b) {
	return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** 時刻を日本時間の暦日に変換する */
export function jstDay(instant) {
	return fromUtc(new Date(instant.getTime() + JST_OFFSET_MS));
}

/** @param {Day} day */
export function addDays(day, n) {
	return makeDay(day.year, day.month, day.day + n);
}

/** "YYYY-MM-DD" を暦日に変換する。存在しない日付なら null */
export function parseIsoDay(text) {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? '');
	if (!m) return null;
	const [year, month, day] = m.slice(1).map(Number);
	const t = new Date(Date.UTC(year, month - 1, day));
	return t.getUTCMonth() === month - 1 && t.getUTCDate() === day ? fromUtc(t) : null;
}

/** @param {Day} day 例: "11月17日(火)" */
export function formatDay(day) {
	return `${day.month}月${day.day}日(${WEEKDAYS[day.weekday]})`;
}

/** @param {Day} day 例: "2026-11-17" */
export function isoDay(day) {
	return `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
}
