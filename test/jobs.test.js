import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeDay } from '../src/date.js';
import { sanitizeMenu } from '../src/discord.js';
import { CRON_JOBS, collectErrors, runJob } from '../src/jobs.js';
import { SOURCE_PAGES } from '../src/scraper.js';
import { WEEK_NOV_3, WEEK_NOV_4 } from './helpers.js';

const loaderFrom = (pages) => async (url) => {
	const page = pages[url];
	if (page instanceof Error) throw page;
	return page;
};
const normal = loaderFrom({ [SOURCE_PAGES[0]]: WEEK_NOV_3, [SOURCE_PAGES[1]]: WEEK_NOV_4 });

describe('runJob', () => {
	it('lunch: 見つかれば出典つきで投稿', async () => {
		const { payload } = await runJob('lunch', makeDay(2026, 11, 24), normal);
		const [embed] = payload.embeds;
		assert.equal(embed.title, '【11月24日(火)】本日の日替わりランチ');
		assert.equal(embed.description, '**テストD定食**\n\n🕒 11:00から販売開始！');
		assert.equal(embed.url, SOURCE_PAGES[1]);
		assert.equal(embed.footer.text, `${SOURCE_PAGES[1]} より引用`);
	});

	it('dinner: 夕食セットの行を読む', async () => {
		const { payload } = await runJob('dinner', makeDay(2026, 11, 17), normal);
		assert.equal(payload.embeds[0].description, '**夕食2**\n\n🕒 16:30から販売開始！');
	});

	it('lunch: 休み・掲載なしなら投稿しない', async () => {
		assert.equal((await runJob('lunch', makeDay(2026, 11, 23), normal)).payload, null);
		assert.equal((await runJob('lunch', makeDay(2026, 11, 28), normal)).payload, null);
	});

	it('preview: 翌日のランチと夕食をまとめる', async () => {
		const { day, payload } = await runJob('preview', makeDay(2026, 11, 24), normal);
		assert.deepEqual(day, makeDay(2026, 11, 25));
		const [embed] = payload.embeds;
		assert.equal(embed.title, '【11月25日(水)】明日のメニュー予告');
		assert.deepEqual(
			embed.fields.map((f) => f.value),
			['**テストE定食**', '**夕食E**'],
		);
	});

	it('preview: 翌日が土日なら「お休み」', async () => {
		const { payload } = await runJob('preview', makeDay(2026, 11, 27), normal);
		assert.deepEqual(payload, { content: '【11月28日(土)】明日はお休みです。' });
	});

	it('preview: 翌日が表に載っていて空欄（祝日など）なら「お休み」', async () => {
		const { payload } = await runJob('preview', makeDay(2026, 11, 22), normal);
		assert.deepEqual(payload, { content: '【11月23日(月)】明日はお休みです。' });
	});

	it('preview: 平日なのにどの週にも載っていない（長期休みで更新停止など）なら投稿しない', async () => {
		const { payload } = await runJob('preview', makeDay(2026, 12, 14), normal);
		assert.equal(payload, null);
	});

	it('preview: 取得に失敗したときは「お休み」と告知しない', async () => {
		const failing = loaderFrom({ [SOURCE_PAGES[0]]: WEEK_NOV_3, [SOURCE_PAGES[1]]: new Error('HTTP 500') });
		const { payload, lookups } = await runJob('preview', makeDay(2026, 11, 24), failing);
		assert.equal(payload, null);
		assert.deepEqual(collectErrors(lookups), [`[lunch] ${SOURCE_PAGES[1]}: HTTP 500`, `[dinner] ${SOURCE_PAGES[1]}: HTTP 500`]);
	});

	it('wrangler.jsonc の cron はすべて CRON_JOBS に登録されている（未登録だと黙って何もしない）', async () => {
		const { readFile } = await import('node:fs/promises');
		const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
		const crons = [...config.matchAll(/^\s*"([0-9*/ ,-]+)",?\s*(?:\/\/.*)?$/gm)].map((m) => m[1]);
		for (const cron of crons) assert.ok(cron in CRON_JOBS, `${cron} が CRON_JOBS にない`);
	});
});

describe('sanitizeMenu', () => {
	it('リンク・メンション・Markdown を無効化する', () => {
		assert.equal(sanitizeMenu('カレー https://evil.example/x'), 'カレー （リンク省略）');
		assert.equal(
			sanitizeMenu('@everyone [押して](x) **太字** `code` ||spoiler||'),
			'\\@everyone \\[押して\\]\\(x\\) \\*\\*太字\\*\\* \\`code\\` \\|\\|spoiler\\|\\|',
		);
	});

	it('長すぎる文字列は切り詰める', () => {
		const result = sanitizeMenu('あ'.repeat(500));
		assert.equal(result, 'あ'.repeat(200) + '…');
	});
});
