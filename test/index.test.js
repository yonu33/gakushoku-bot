import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import worker from '../src/index.js';
import { SOURCE_PAGES } from '../src/scraper.js';
import { WEEK_NOV_3, WEEK_NOV_4 } from './helpers.js';

const WEBHOOK = 'https://discord.example/api/webhooks/main';
const ALERT = 'https://discord.example/api/webhooks/alert';
const env = { DISCORD_WEBHOOK_URL: WEBHOOK, TEST_SECRET_KEY: 's3cret' };

let calls;
let upstream;
const realFetch = globalThis.fetch;

beforeEach(() => {
	calls = [];
	upstream = { [SOURCE_PAGES[0]]: WEEK_NOV_3, [SOURCE_PAGES[1]]: WEEK_NOV_4 };
	globalThis.fetch = async (url, init = {}) => {
		calls.push({ url: String(url), init });
		const page = upstream[url];
		if (typeof page === 'number') return new Response('error', { status: page });
		if (page !== undefined) return new Response(page);
		return new Response(null, { status: 204 });
	};
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

const posts = (url = WEBHOOK) => calls.filter((c) => c.url === url).map((c) => JSON.parse(c.init.body));
const upstreamCalls = () => calls.filter((c) => c.url.includes('gakushoku.com'));
const request = (query, headers = { Authorization: 'Bearer s3cret' }) => new Request(`https://bot.example/?${query}`, { headers });

describe('動作確認エンドポイント', () => {
	it('TEST_SECRET_KEY 未設定なら 404', async () => {
		const res = await worker.fetch(request('test=lunch'), { DISCORD_WEBHOOK_URL: WEBHOOK });
		assert.equal(res.status, 404);
	});

	it('キーがない・違う場合は 401 で、取得元にも Discord にもアクセスしない', async () => {
		assert.equal((await worker.fetch(request('test=lunch', {}), env)).status, 401);
		assert.equal((await worker.fetch(request('test=lunch', { Authorization: 'Bearer wrong' }), env)).status, 401);
		assert.equal((await worker.fetch(request('test=lunch&key=wrong', {}), env)).status, 401);
		assert.equal(calls.length, 0);
	});

	it('ブラウザ用に ?key= でも認証できる（前後の空白は無視）', async () => {
		assert.equal((await worker.fetch(request('test=lunch&date=2026-11-24&key=s3cret', {}), env)).status, 200);
		assert.equal((await worker.fetch(request('test=lunch&date=2026-11-24&key=%20s3cret%0A', {}), env)).status, 200);
		assert.equal(posts().length, 0);
	});

	it('既定は投稿せずに結果を返す', async () => {
		const res = await worker.fetch(request('test=preview&date=2026-11-24'), env);
		assert.equal(res.status, 200);
		const body = await res.json();
		assert.equal(body.target, '2026-11-25');
		assert.equal(body.posted, false);
		assert.equal(body.payload.embeds[0].title, '【11月25日(水)】明日のメニュー予告');
		assert.equal(posts().length, 0);
		assert.equal(upstreamCalls().length, 2);
	});

	it('post=1 なら投稿する（メンションは常に無効）', async () => {
		const res = await worker.fetch(request('test=dinner&date=2026-11-17&post=1'), env);
		assert.equal((await res.json()).posted, true);
		const [payload] = posts();
		assert.equal(payload.embeds[0].description, '**夕食2**\n\n🕒 16:30から販売開始！');
		assert.deepEqual(payload.allowed_mentions, { parse: [] });
	});

	it('不正なパラメータは 400', async () => {
		assert.equal((await worker.fetch(request('test=breakfast'), env)).status, 400);
		assert.equal((await worker.fetch(request('test=lunch&date=2026-02-30'), env)).status, 400);
		assert.equal((await worker.fetch(request('test=lunch&date=tomorrow'), env)).status, 400);
	});
});

describe('定期実行', () => {
	const at = (iso) => Date.parse(iso);

	it('10:00 JST にその日のランチを投稿する', async () => {
		await worker.scheduled({ cron: '0 1 * * *', scheduledTime: at('2026-11-24T01:00:00Z') }, env);
		assert.equal(posts()[0].embeds[0].title, '【11月24日(火)】本日の日替わりランチ');
	});

	it('19:00 JST の予告は翌日分（日付の境目を日本時間で判定する）', async () => {
		await worker.scheduled({ cron: '0 10 * * *', scheduledTime: at('2026-11-24T10:00:00Z') }, env);
		assert.equal(posts()[0].embeds[0].title, '【11月25日(水)】明日のメニュー予告');
	});

	it('取得エラーはアラート用 Webhook にだけ流し、メインには「お休み」と流さない', async () => {
		upstream[SOURCE_PAGES[1]] = 500;
		await worker.scheduled({ cron: '0 10 * * *', scheduledTime: at('2026-11-24T10:00:00Z') }, { ...env, ALERT_WEBHOOK_URL: ALERT });
		assert.equal(posts().length, 0);
		const [alert] = posts(ALERT);
		assert.match(alert.content, /HTTP 500/);
	});

	it('未登録の cron では何もしない', async () => {
		await worker.scheduled({ cron: '5 5 * * *', scheduledTime: Date.now() }, env);
		assert.equal(calls.length, 0);
	});

	it('Discord への投稿に失敗したら例外にする（Cloudflare 側で失敗として記録される）', async () => {
		upstream[WEBHOOK] = 429;
		await assert.rejects(worker.scheduled({ cron: '0 1 * * *', scheduledTime: at('2026-11-24T01:00:00Z') }, env), /HTTP 429/);
	});
});
