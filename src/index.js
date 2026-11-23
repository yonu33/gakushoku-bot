export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const testType = url.searchParams.get("test");
    const providedKey = url.searchParams.get("key");
    const dateParam = url.searchParams.get("date"); 

    if (!providedKey || providedKey !== env.TEST_SECRET_KEY) {
      return new Response("Unauthorized", { status: 403 });
    }

    let jstNow = dateParam 
      ? new Date(dateParam + "T12:00:00+09:00") 
      : new Date(Date.now() + 9 * 60 * 60 * 1000);

    let manualTestType = null;
    if (testType === "lunch") manualTestType = "lunch_test";
    else if (testType === "dinner") manualTestType = "dinner_test";
    else if (testType === "preview") manualTestType = "preview_test";
    else return new Response("Invalid test type", { status: 400 });

    await this.scheduled(null, env, ctx, manualTestType, jstNow); 
    return new Response(`OK: Test triggered for ${jstNow.toLocaleDateString('ja-JP')}.`, { status: 200 });
  },

  async scheduled(event, env, ctx, manualTestType = null, manualDate = null) {
    const jstNow = manualDate || new Date(Date.now() + 9 * 60 * 60 * 1000);
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const trigger = manualTestType || (event ? event.cron : null);

    // 当日通知(lunch)
    if (trigger === "0 1 * * *" || trigger === "lunch_test") {
      try {
        const res = await scrapeByExactColumn(2, jstNow, 0); // ランチは2行目
        if (res.dateMatch && res.menuText && !res.menuText.includes("お休み")) {
          const dateStr = `${jstNow.getUTCMonth() + 1}月${jstNow.getUTCDate()}日(${weekdays[jstNow.getUTCDay()]})`;
          await postToDiscord(env.DISCORD_WEBHOOK_URL, {
            embeds: [{
              title: `【${dateStr}】本日の日替わりランチ`,
              description: `**${res.menuText}**\n\n🕒 11:00から販売開始！`,
              color: 16752762,
              footer: { text: `${res.usedUrl} より引用` },
            }],
          });
        }
      } catch (e) { console.error(e); }

    // 当日通知(dinner)
    } else if (trigger === "30 6 * * *" || trigger === "dinner_test") {
      try {
        const res = await scrapeByExactColumn(6, jstNow, 0); // 夕食は5行目
        if (res.dateMatch && res.menuText && !res.menuText.includes("お休み")) {
          const dateStr = `${jstNow.getUTCMonth() + 1}月${jstNow.getUTCDate()}日(${weekdays[jstNow.getUTCDay()]})`;
          await postToDiscord(env.DISCORD_WEBHOOK_URL, {
            embeds: [{
              title: `【${dateStr}】本日の夕食セット`,
              description: `**${res.menuText}**\n\n🕒 16:30から販売開始！`,
              color: 10079487,
              footer: { text: `${res.usedUrl} より引用` },
            }],
          });
        }
      } catch (e) { console.error(e); }

    // preview
    } else if (trigger === "0 10 * * *" || trigger === "preview_test") {
      try {
        const targetDate = new Date(jstNow.getTime() + (24 * 60 * 60 * 1000));
        const tmrDateStr = `${targetDate.getUTCMonth() + 1}月${targetDate.getUTCDate()}日(${weekdays[targetDate.getUTCDay()]})`;

        const resLunch = await scrapeByExactColumn(2, jstNow, 1);
        const resDinner = await scrapeByExactColumn(6, jstNow, 1);

        if (resLunch.dateMatch || resDinner.dateMatch) {
          const lText = (resLunch.menuText && !resLunch.menuText.includes("お休み")) ? resLunch.menuText : "（情報なし/お休み）";
          const dText = (resDinner.menuText && !resDinner.menuText.includes("お休み")) ? resDinner.menuText : "（情報なし/お休み）";

          await postToDiscord(env.DISCORD_WEBHOOK_URL, {
            embeds: [{
              title: `【${tmrDateStr}】明日のメニュー予告`,
              color: 34168,
              fields: [
                { name: "🌞 日替わりランチ", value: `**${lText}**`, inline: false },
                { name: "🌙 夕食セット", value: `**${dText}**`, inline: false }
              ],
              footer: { text: `${resLunch.usedUrl || resDinner.usedUrl || ""} より引用` },
            }],
          });
        } else {
          await postToDiscord(env.DISCORD_WEBHOOK_URL, { content: `【${tmrDateStr}】明日はお休みです。` });
        }
      } catch (e) { console.error(e); }
    }
  },
};

async function scrapeByExactColumn(rowIndex, jstNow, dayOffset) {
  const targetDate = new Date(jstNow.getTime() + (dayOffset * 24 * 60 * 60 * 1000));
  const targetDay = targetDate.getUTCDate().toString(); 
  const urls = ["http://www.gakushoku.com/univ_mn1.php", "http://www.gakushoku.com/univ_mn2.php"];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      const html = await response.text();
      const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
      if (!rows[0]) continue;

      const dateCells = rows[0].match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi) || [];
      let colIndex = -1;
      
      // 修正点1: 3月の「3」と、3日の「3」を間違えないように照合
      for (let i = 0; i < dateCells.length; i++) {
        const cellText = dateCells[i].replace(/<[^>]*>/g, "").trim();
        const dayMatch = cellText.match(/(\d+)日/); // 「◯日」という形式から数字だけを抜く
        if (dayMatch && dayMatch[1] === targetDay) {
          colIndex = i;
          break;
        }
      }

      if (colIndex !== -1 && rows[rowIndex - 1]) {
        const menuCells = rows[rowIndex - 1].match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi) || [];
        if (menuCells[colIndex]) {
          // 修正点2: 一行ずつ綺麗に表示するロジック
          const menuText = menuCells[colIndex]
            .replace(/<br\s*\/?>/gi, "\n")      // <br>を改行に
            .replace(/<[^>]*>/g, "")           // その他のタグを削除
            .split("\n")                       // 一旦バラバラにする
            .map(line => line.trim())          // 空白を消す
            .filter(line => line !== "")       // 空行を消す
            .join("\n");                       // 一行ずつつなぎ直す

          if (menuText && menuText.length > 1) {
            return { menuText: menuText, usedUrl: url, dateMatch: true };
          }
        }
      }
    } catch (e) { console.error(e); }
  }
  return { menuText: "お休み", usedUrl: null, dateMatch: false };
}

async function postToDiscord(url, payload) {
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
