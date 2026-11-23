// Discord への投稿。
// 取得元のテキストは外部の入力なので、そのまま流さずに整形する（リンク・メンション・Markdown を無効化）。

const MAX_MENU_CHARS = 200;
const POST_TIMEOUT_MS = 10_000;

/** 取得したメニュー文字列を Discord に安全に載せられる形にする */
export function sanitizeMenu(text) {
	let s = text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/https?:\/\/\S+/gi, '（リンク省略）');
	const chars = Array.from(s);
	if (chars.length > MAX_MENU_CHARS) s = chars.slice(0, MAX_MENU_CHARS).join('') + '…';
	return s.replace(/[\\*_~`|<>[\]()#@:-]/g, '\\$&');
}

/** Webhook に投稿する。メンションは常に無効化する */
export async function postToDiscord(webhookUrl, payload, fetchImpl = (...args) => fetch(...args)) {
	if (!webhookUrl) throw new Error('Webhook URL が設定されていません');
	const res = await fetchImpl(webhookUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
		signal: AbortSignal.timeout(POST_TIMEOUT_MS),
	});
	// Webhook URL 自体が秘密情報なので、エラーメッセージには含めない
	if (!res.ok) throw new Error(`Discord への投稿に失敗しました (HTTP ${res.status})`);
}
