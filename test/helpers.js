// テスト用の HTML を組み立てる。
// 取得元のページをそのまま保存してコミットすると公開リポジトリで再配布することになるので、
// 構造だけを真似た架空のメニューで作る。

/**
 * @param {{ week: string, days: string[], rows: Record<string, string[]> }} spec
 */
export function menuPage({ week, days, rows }) {
	const header = `<tr>\n<th class="st">${week}</th>\n${days.map((d) => `<th>${d}</th>`).join('\n')}\n</tr>`;
	const body = Object.entries(rows)
		.map(
			([label, cells]) =>
				`<tr>\n<th class="st">${label}<!--<p class="price">円<span class="tax"> ＋税</span></p>--></th>\n${cells
					.map((c) => `<td>${c}</td>`)
					.join('\n')}\n</tr>`,
		)
		.join('\n');
	return `<!DOCTYPE html><html><body>
<nav><table class="calendar"><tr><td>1日（月）</td><td>ナビ</td></tr></table></nav>
<h3>【 ${week} 】日替わりメニュー</h3>
<table class="day">
${header}
${body}
</table>
<p class="copyright"><small>Copyright &copy; Example</small></p>
</body></html>`;
}

/** 2026年11月 第3週（16〜20日）。学期中の形（行が多い） */
export const WEEK_NOV_3 = menuPage({
	week: '11月 第3週',
	days: ['16日（月）', '17日（火）', '18日（水）', '19日（木）', '20日（金）'],
	rows: {
		日替わりランチ: ['テストA定食<br />\n小鉢<br />\nライス、味噌汁', 'テストB定食<br />\nサラダ', 'テストC丼', '', 'お休み'],
		単品: ['単品1', '単品2', '単品3', '単品4', '単品5'],
		麺類: ['', '', '', '麺', ''],
		魚: ['魚1', '魚2', '魚3', '魚4', '魚5'],
		夕食セット: ['夕食1', '夕食2', '夕食3', '夕食4', '夕食5'],
	},
});

/** 2026年11月 第4週（23〜27日）。23日は祝日で空欄 */
export const WEEK_NOV_4 = menuPage({
	week: '11月 第4週',
	days: ['23日（月）', '24日（火）', '25日（水）', '26日（木）', '27日（金）'],
	rows: {
		日替わりランチ: ['', 'テストD定食', 'テストE定食', 'テストF定食', 'テストG定食'],
		夕食セット: ['', '夕食D', '夕食E', '夕食F', '夕食G'],
	},
});
