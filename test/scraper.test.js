import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeDay } from '../src/date.js';
import { LayoutError, SOURCE_PAGES, USER_AGENT, createPageLoader, findMenu, lookupMenu, parseMenuTable, textOf } from '../src/scraper.js';
import { WEEK_NOV_3, WEEK_NOV_4, menuPage } from './helpers.js';

const find = (html, [y, m, d], row) => findMenu(parseMenuTable(html), makeDay(y, m, d), row);

describe('findMenu', () => {
	it('行の位置ではなく見出しで行を探す', () => {
		// 元の実装は「5 行目 = 夕食セット」決め打ちで、行が増えた週は「魚」を夕食として投稿していた
		assert.deepEqual(find(WEEK_NOV_3, [2026, 11, 17], '夕食セット'), { status: 'found', menu: '夕食2' });
		assert.deepEqual(find(WEEK_NOV_3, [2026, 11, 16], '日替わりランチ'), { status: 'found', menu: 'テストA定食\n小鉢\nライス、味噌汁' });
	});

	it('空欄・お休みは closed', () => {
		assert.deepEqual(find(WEEK_NOV_3, [2026, 11, 19], '日替わりランチ'), { status: 'closed' });
		assert.deepEqual(find(WEEK_NOV_3, [2026, 11, 20], '日替わりランチ'), { status: 'closed' });
	});

	it('表にない日は not_listed', () => {
		assert.deepEqual(find(WEEK_NOV_3, [2026, 11, 21], '日替わりランチ'), { status: 'not_listed' });
		assert.deepEqual(find(WEEK_NOV_3, [2026, 11, 23], '日替わりランチ'), { status: 'not_listed' });
	});

	it('更新が止まった古いページの「同じ日」を別の月に拾わない', () => {
		// 長期休み中に 11月のページが残ったまま 12/16 になったケース
		assert.deepEqual(find(WEEK_NOV_3, [2026, 12, 16], '日替わりランチ'), { status: 'not_listed' });
		// 1 年前のページが残っていたケース（曜日がずれる）
		assert.deepEqual(find(WEEK_NOV_3, [2027, 11, 16], '日替わりランチ'), { status: 'not_listed' });
	});

	it('28 日しかない 2 月のページを 3 月の同じ日に拾わない（曜日も同じになる）', () => {
		const feb = menuPage({
			week: '2月 第1週',
			days: ['2日（月）', '3日（火）', '4日（水）', '5日（木）', '6日（金）'],
			rows: { 日替わりランチ: ['2月A', '2月B', '2月C', '2月D', '2月E'] },
		});
		assert.equal(find(feb, [2026, 2, 3], '日替わりランチ').status, 'found');
		assert.deepEqual(find(feb, [2026, 3, 3], '日替わりランチ'), { status: 'not_listed' });
	});

	it('見出しの「11月」を 11 日と取り違えない', () => {
		// 元の実装は見出し行の最初の数字で照合していたので、月と日が同じ日（11/11 など）に週名の列を拾っていた
		const week = menuPage({
			week: '11月 第2週',
			days: ['9日（月）', '10日（火）', '11日（水）', '12日（木）', '13日（金）'],
			rows: { 日替わりランチ: ['A', 'B', '水曜のランチ', 'D', 'E'] },
		});
		assert.deepEqual(find(week, [2026, 11, 11], '日替わりランチ'), { status: 'found', menu: '水曜のランチ' });
	});

	it('月をまたぐ週: 後ろの月で表記される場合（実際のページの形）', () => {
		const week = menuPage({
			week: '10月 第1週',
			days: ['28日（月）', '29日（火）', '30日（水）', '1日（木）', '2日（金）'],
			rows: { 日替わりランチ: ['9/28', '9/29', '9/30', '10/1', '10/2'] },
		});
		assert.equal(find(week, [2026, 9, 30], '日替わりランチ').menu, '9/30');
		assert.equal(find(week, [2026, 10, 1], '日替わりランチ').menu, '10/1');
	});

	it('月をまたぐ週: 前の月で表記される場合 / 年をまたぐ場合', () => {
		const week = menuPage({
			week: '12月 第5週',
			days: ['28日（月）', '29日（火）', '30日（水）', '31日（木）', '1日（金）'],
			rows: { 日替わりランチ: ['12/28', '12/29', '12/30', '12/31', '1/1'] },
		});
		assert.equal(find(week, [2026, 12, 31], '日替わりランチ').menu, '12/31');
		assert.equal(find(week, [2027, 1, 1], '日替わりランチ').menu, '1/1');
	});

	it('長期休み中に「夕食セット」の行がない週は closed', () => {
		const week = menuPage({
			week: '10月 第1週',
			days: ['28日（月）', '29日（火）', '30日（水）', '1日（木）', '2日（金）'],
			rows: { 日替わりランチ: ['A', 'B', 'C', 'D', 'E'], 魚: ['魚', '魚', '魚', '魚', '魚'], サラダ: ['s', 's', 's', 's', 's'] },
		});
		assert.deepEqual(find(week, [2026, 10, 1], '夕食セット'), { status: 'closed' });
	});

	it('ランチの行すらない・表がない・曜日が合わないときは LayoutError', () => {
		const noLunch = menuPage({ week: '11月 第3週', days: ['16日（月）'], rows: { 何か: ['x'] } });
		assert.throws(() => find(noLunch, [2026, 11, 16], '夕食セット'), LayoutError);
		assert.throws(() => parseMenuTable('<html><table><tr><td>x</td></tr></table></html>'), LayoutError);
		// 連続する 2 日が両方土曜、はどの年でもありえない
		const broken = menuPage({ week: '11月 第3週', days: ['16日（土）', '17日（土）'], rows: { 日替わりランチ: ['a', 'b'] } });
		assert.throws(() => find(broken, [2026, 11, 16], '日替わりランチ'), LayoutError);
	});
});

describe('textOf', () => {
	it('<br> を改行に、実体参照を文字に、余分な空白を詰める', () => {
		assert.equal(textOf('  鶏&amp;野菜<br />\n  ライス、味噌汁&#x3000; <span>＆</span>'), '鶏&野菜\nライス、味噌汁 ＆');
	});
});

describe('lookupMenu / createPageLoader', () => {
	const pages = { [SOURCE_PAGES[0]]: WEEK_NOV_3, [SOURCE_PAGES[1]]: WEEK_NOV_4 };

	function fakeFetch(overrides = {}) {
		const calls = [];
		const fetchImpl = async (url, init) => {
			calls.push({ url, init });
			const o = overrides[url];
			if (o instanceof Error) throw o;
			if (typeof o === 'number') return new Response('error', { status: o });
			return new Response(pages[url]);
		};
		return { calls, fetchImpl };
	}

	it('1 ページ目になければ 2 ページ目を見る', async () => {
		const { fetchImpl } = fakeFetch();
		const result = await lookupMenu(createPageLoader(fetchImpl), makeDay(2026, 11, 24), '日替わりランチ');
		assert.deepEqual(result, { status: 'found', menu: 'テストD定食', sourceUrl: SOURCE_PAGES[1], errors: [] });
	});

	it('同じ実行の中では同じページを 1 回しか取りに行かない & User-Agent で名乗る', async () => {
		const { calls, fetchImpl } = fakeFetch();
		const load = createPageLoader(fetchImpl);
		await lookupMenu(load, makeDay(2026, 11, 25), '日替わりランチ');
		await lookupMenu(load, makeDay(2026, 11, 25), '夕食セット');
		assert.deepEqual(
			calls.map((c) => c.url),
			SOURCE_PAGES,
		);
		assert.equal(calls[0].init.headers['User-Agent'], USER_AGENT);
		assert.ok(calls[0].init.signal instanceof AbortSignal);
	});

	it('取得に失敗したページがあれば errors に残す（もう一方で見つかれば found）', async () => {
		const { fetchImpl } = fakeFetch({ [SOURCE_PAGES[0]]: 503 });
		const result = await lookupMenu(createPageLoader(fetchImpl), makeDay(2026, 11, 24), '日替わりランチ');
		assert.equal(result.status, 'found');
		assert.deepEqual(result.errors, [`${SOURCE_PAGES[0]}: HTTP 503`]);
	});

	it('見つからず、どこかで失敗していたら error（休みかどうか判断できない）', async () => {
		const { fetchImpl } = fakeFetch({ [SOURCE_PAGES[1]]: new Error('timeout') });
		const result = await lookupMenu(createPageLoader(fetchImpl), makeDay(2026, 11, 24), '日替わりランチ');
		assert.equal(result.status, 'error');
		assert.deepEqual(result.errors, [`${SOURCE_PAGES[1]}: timeout`]);
	});

	it('どのページにもなく、失敗もなければ not_listed', async () => {
		const { fetchImpl } = fakeFetch();
		const result = await lookupMenu(createPageLoader(fetchImpl), makeDay(2026, 11, 28), '日替わりランチ');
		assert.deepEqual(result, { status: 'not_listed', errors: [] });
	});
});
