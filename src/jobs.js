// 各ジョブ（当日ランチ / 当日夕食 / 翌日予告）の実行と、投稿内容の組み立て。
// ここでは投稿しない。投稿するかどうかは呼び出し側（index.js）が決める。

import { addDays, formatDay } from './date.js';
import { sanitizeMenu } from './discord.js';
import { lookupMenu } from './scraper.js';

export const MEALS = {
	lunch: { row: '日替わりランチ', title: '本日の日替わりランチ', note: '🕒 11:00から販売開始！', color: 16752762 },
	dinner: { row: '夕食セット', title: '本日の夕食セット', note: '🕒 16:30から販売開始！', color: 10079487 },
};

export const JOBS = ['lunch', 'dinner', 'preview'];

/** cron 式（UTC）→ ジョブ。wrangler.jsonc の triggers.crons と揃えること */
export const CRON_JOBS = {
	'0 1 * * *': 'lunch', // 10:00 JST
	'30 6 * * *': 'dinner', // 15:30 JST
	'0 10 * * *': 'preview', // 19:00 JST
};

/**
 * @param {'lunch' | 'dinner' | 'preview'} job
 * @param {import('./date.js').Day} today 日本時間の今日
 * @returns {Promise<{ day: import('./date.js').Day, lookups: Record<string, Awaited<ReturnType<typeof lookupMenu>>>, payload: object | null }>}
 *   payload が null のときは何も投稿しない
 */
export async function runJob(job, today, loadPage) {
	if (job === 'preview') {
		const day = addDays(today, 1);
		const lunch = await lookupMenu(loadPage, day, MEALS.lunch.row);
		const dinner = await lookupMenu(loadPage, day, MEALS.dinner.row);
		return { day, lookups: { lunch, dinner }, payload: previewPayload(day, lunch, dinner) };
	}

	const meal = MEALS[job];
	const result = await lookupMenu(loadPage, today, meal.row);
	return { day: today, lookups: { [job]: result }, payload: result.status === 'found' ? mealPayload(meal, today, result) : null };
}

/** 全 lookup のエラーを 1 つのリストにまとめる */
export function collectErrors(lookups) {
	return Object.entries(lookups).flatMap(([name, result]) => result.errors.map((e) => `[${name}] ${e}`));
}

function mealPayload(meal, day, result) {
	return {
		embeds: [
			{
				title: `【${formatDay(day)}】${meal.title}`,
				url: result.sourceUrl,
				description: `**${sanitizeMenu(result.menu)}**\n\n${meal.note}`,
				color: meal.color,
				footer: { text: `${result.sourceUrl} より引用` },
			},
		],
	};
}

function previewPayload(day, lunch, dinner) {
	const label = `【${formatDay(day)}】`;
	const found = [lunch, dinner].find((r) => r.status === 'found');

	if (!found) {
		// 取得に失敗しているときに「お休み」と誤って告知しない
		if (lunch.status === 'error' || dinner.status === 'error') return null;
		// 「お休み」と言い切るのは、表に載っていて空欄/お休みの日（祝日など）と土日だけ。
		// 平日なのにどの週にも載っていない（長期休み中に更新が止まっている等）ときは投稿しない
		const isWeekend = day.weekday === 0 || day.weekday === 6;
		if (!isWeekend && lunch.status !== 'closed' && dinner.status !== 'closed') return null;
		return { content: `${label}明日はお休みです。` };
	}

	const value = (r) =>
		`**${r.status === 'found' ? sanitizeMenu(r.menu) : r.status === 'error' ? '（取得できませんでした）' : '（情報なし/お休み）'}**`;
	return {
		embeds: [
			{
				title: `${label}明日のメニュー予告`,
				url: found.sourceUrl,
				color: 34168,
				fields: [
					{ name: '🌞 日替わりランチ', value: value(lunch), inline: false },
					{ name: '🌙 夕食セット', value: value(dinner), inline: false },
				],
				footer: { text: `${found.sourceUrl} より引用` },
			},
		],
	};
}
