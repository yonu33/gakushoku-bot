import { isoDay, jstDay, parseIsoDay } from './date.js';
import { postToDiscord } from './discord.js';
import { CRON_JOBS, JOBS, collectErrors, runJob } from './jobs.js';
import { createPageLoader } from './scraper.js';

export default {
	async scheduled(controller, env) {
		const job = CRON_JOBS[controller.cron];
		if (!job) {
			console.warn(`未登録の cron です: ${controller.cron}`);
			return;
		}
		await execute(job, jstDay(new Date(controller.scheduledTime)), env, { post: true });
	},

	/**
	 * 動作確認用のエンドポイント（README の「動作確認」参照）。
	 * 既定は投稿せずに結果を JSON で返す。post=1 のときだけ実際に投稿する。
	 */
	async fetch(request, env) {
		if (!env.TEST_SECRET_KEY) return new Response('Not Found', { status: 404 });
		const params = new URL(request.url).searchParams;
		// キーは Authorization ヘッダー（curl 用）か ?key=（ブラウザ用）で受け取る。
		// ?key= はブラウザ履歴と Cloudflare のログに残るが、手軽さを優先している
		const provided = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1] ?? params.get('key') ?? '';
		if (!(await safeEqual(provided.trim(), env.TEST_SECRET_KEY.trim()))) {
			return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
		}
		if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

		const job = params.get('test');
		if (!JOBS.includes(job)) return json({ error: 'test には lunch / dinner / preview のいずれかを指定してください' }, 400);
		const today = params.has('date') ? parseIsoDay(params.get('date')) : jstDay(new Date());
		if (!today) return json({ error: 'date は YYYY-MM-DD 形式で指定してください' }, 400);
		const post = params.get('post') === '1';

		const { day, lookups, payload, errors } = await execute(job, today, env, { post });
		return json({ job, today: isoDay(today), target: isoDay(day), posted: post && payload !== null, payload, lookups, errors });
	},
};

async function execute(job, today, env, { post }) {
	const result = await runJob(job, today, createPageLoader());
	const errors = collectErrors(result.lookups);
	if (errors.length) {
		console.error(`[${job}] 取得エラー`, errors);
		if (post) await notifyAlert(env, job, errors);
	}
	if (post && result.payload) await postToDiscord(env.DISCORD_WEBHOOK_URL, result.payload);
	return { ...result, errors };
}

/** 取得エラーを運用者向けチャンネルに通知する（ALERT_WEBHOOK_URL が未設定なら何もしない） */
async function notifyAlert(env, job, errors) {
	if (!env.ALERT_WEBHOOK_URL) return;
	try {
		const body = errors.join('\n').replaceAll('`', "'").slice(0, 1800);
		await postToDiscord(env.ALERT_WEBHOOK_URL, { content: `⚠️ gakushoku-bot (${job}) で取得エラー\n\`\`\`\n${body}\n\`\`\`` });
	} catch (e) {
		console.error('アラートの送信に失敗しました', e);
	}
}

/** 長さや内容に関係なく同じ時間で比較する（ハッシュしてから比べる） */
async function safeEqual(a, b) {
	const encoder = new TextEncoder();
	const [x, y] = await Promise.all([a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(s)))));
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
	return diff === 0;
}

function json(body, status = 200) {
	return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
