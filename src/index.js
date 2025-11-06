export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const testType = url.searchParams.get("test");
    const providedKey = url.searchParams.get("key");
    const dateParam = url.searchParams.get("date"); 

    if (!providedKey || providedKey !== env.TEST_SECRET_KEY) {
      return new Response("Unauthorized: Invalid or missing secret key.", { status: 403 });
    }

    let jstNow;
    if (dateParam) {
      jstNow = new Date(dateParam + "T12:00:00+09:00"); 
      if (isNaN(jstNow.getTime())) {
        return new Response("Invalid date format. Use YYYY-MM-DD", { status: 400 });
      }
    } else {
      jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    }

    let manualTestType = null;
    let responseMessage = `OK: Test triggered for ${jstNow.toISOString().split('T')[0]}.`;

    if (testType === "lunch") {
      manualTestType = "lunch_test";
    } else if (testType === "dinner") {
      manualTestType = "dinner_test";
    } else if (testType === "preview") {
      manualTestType = "preview_test";
    } else {
      return new Response("Invalid test type. Use ?test=lunch, ?test=dinner, or ?test=preview", { status: 400 });
    }

    await this.scheduled(null, env, ctx, manualTestType, jstNow); 
    
    return new Response(responseMessage, { status: 200 });
  },

  async scheduled(event, env, ctx, manualTestType = null, manualDate = null) {
    
    const jstNow = manualDate || new Date(Date.now() + 9 * 60 * 60 * 1000);
    
    const month = jstNow.getUTCMonth() + 1;
    const day = jstNow.getUTCDate();
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const dayOfWeekIndex = jstNow.getUTCDay();
    const weekday = weekdays[dayOfWeekIndex];
    const dateString = `${month}月${day}日(${weekday})`;

    let mealType;
    let baseRowSelector;
    let messageTitle;

    const trigger = manualTestType || (event ? event.cron : null);

    if (trigger === "0 1 * * *" || trigger === "lunch_test") {
      mealType = "lunch";
      messageTitle = (trigger === "lunch_test") 
        ? `【${dateString}】(TEST) 日替わりランチ` 
        : `【${dateString}】本日の日替わりランチ`;
      baseRowSelector = "section table tr:nth-child(2)";

      try {
        const { menuText, usedUrl } = await scrapeDynamicMenu(baseRowSelector, jstNow, 0);
        if (menuText && !menuText.includes("お休み")) {
          await postToDiscord(env.DISCORD_WEBHOOK_URL, {
            embeds: [{
              title: messageTitle,
              description: `**${menuText}**`,
              color: 16752762,
              footer: { text: `${usedUrl}より引用` },
            }],
          });
        }
      } catch (error) {
        console.error(`Error during ${mealType} scraping:`, error);
        await postToDiscord(env.DISCORD_WEBHOOK_URL, { content: `**Botエラー**\n${mealType}のスクレイピング中にエラーが発生しました。\n\`${error.message}\`` });
      }
      
    } else if (trigger === "30 6 * * *" || trigger === "dinner_test") {
      mealType = "dinner";
      messageTitle = (trigger === "dinner_test")
        ? `【${dateString}】(TEST) 本日の夕食セット`
        : `【${dateString}】本日の夕食セット`;
      baseRowSelector = "section table tr:nth-child(5)";

      try {
        const { menuText, usedUrl } = await scrapeDynamicMenu(baseRowSelector, jstNow, 0);
        if (menuText && !menuText.includes("お休み")) {
          await postToDiscord(env.DISCORD_WEBHOOK_URL, {
            embeds: [{
              title: messageTitle,
              description: `**${menuText}**`,
              color: 10079487,
              footer: { text: `${usedUrl}より引用` },
            }],
          });
        }
      } catch (error) {
        console.error(`Error during ${mealType} scraping:`, error);
        await postToDiscord(env.DISCORD_WEBHOOK_URL, { content: `**Botエラー**\n${mealType}のスクレイピング中にエラーが発生しました。\n\`${error.message}\`` });
      }

    } else if (trigger === "0 10 * * *" || trigger === "preview_test") {
      mealType = "preview";
      
      const dayOffset = 1;
      const targetDate = new Date(jstNow.getTime() + (dayOffset * 24 * 60 * 60 * 1000));
      const tmrMonth = targetDate.getUTCMonth() + 1;
      const tmrDay = targetDate.getUTCDate();
      const tmrWeekday = weekdays[targetDate.getUTCDay()];
      const tomorrowDateString = `${tmrMonth}月${tmrDay}日(${tmrWeekday})`;

      messageTitle = (trigger === "preview_test")
        ? `【${tomorrowDateString}】(TEST) 明日のメニュー予告`
        : `【${tomorrowDateString}】明日のメニュー予告`;

      try {
        const lunchSelector = "section table tr:nth-child(2)";
        const dinnerSelector = "section table tr:nth-child(5)";
        
        const { menuText: lunchMenu, usedUrl } = await scrapeDynamicMenu(lunchSelector, jstNow, dayOffset);
        const { menuText: dinnerMenu } = await scrapeDynamicMenu(dinnerSelector, jstNow, dayOffset);

        const isLunchValid = (lunchMenu && !lunchMenu.includes("お休み"));
        const isDinnerValid = (dinnerMenu && !dinnerMenu.includes("お休み"));

        if (!isLunchValid && !isDinnerValid) {
          await postToDiscord(env.DISCORD_WEBHOOK_URL, {
            content: `【${tomorrowDateString}】明日はお休みです。`,
          });
        } else {
          const lunchText = isLunchValid ? lunchMenu : "（情報なし/お休み）";
          const dinnerText = isDinnerValid ? dinnerMenu : "（情報なし/お休み）";

          await postToDiscord(env.DISCORD_WEBHOOK_URL, {
            embeds: [{
              title: messageTitle,
              color: 34168,
              fields: [
                { name: "🌞 日替わりランチ", value: `**${lunchText}**`, inline: false },
                { name: "🌙 夕食セット", value: `**${dinnerText}**`, inline: false }
              ],
              footer: { text: `${usedUrl}より引用` },
            }],
          });
        }

      } catch (error) {
        console.error(`Error during ${mealType} scraping:`, error);
        await postToDiscord(env.DISCORD_WEBHOOK_URL, { content: `**Botエラー**\n明日のメニューのスクレイピング中にエラーが発生しました。\n\`${error.message}\`` });
      }
    
    } else {
      console.log(`Scheduled time does not match: ${event ? event.cron : 'manual'}`);
      return;
    }
  },
};

async function scrapeDynamicMenu(baseRowSelector, jstNow, dayOffset = 0) {
  
  let targetDate = jstNow;
  if (dayOffset > 0) {
    targetDate = new Date(jstNow.getTime() + (dayOffset * 24 * 60 * 60 * 1000));
  }
  
  const dayOfWeek = targetDate.getUTCDay();
  
  let url = "";

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { menuText: "本日はお休みです", usedUrl: url };
  }
  const columnIndex = dayOfWeek + 1;
  const finalSelector = `${baseRowSelector} td:nth-child(${columnIndex})`;

  const weekNumber = getWeekNumber(targetDate);
  
  if (weekNumber % 2 === 0) {
    url = "http://www.gakushoku.com/univ_mn1.php";
  } else {
    url = "http://www.gakushoku.com/univ_mn2.php";
  }

  let menuText = "";
  let found = false;

  class ElementHandler {
    text(textChunk) {
      if (found) return;
      menuText += textChunk.text;
      if (textChunk.last) {
        found = true;
      }
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status}`);
  }

  const rewriter = new HTMLRewriter()
    .on(finalSelector, new ElementHandler());

  await rewriter.transform(response).arrayBuffer();
  
  return { menuText: menuText.trim(), usedUrl: url };
}

async function postToDiscord(webhookURL, payload) {
  if (!webhookURL) {
      throw new Error("DISCORD_WEBHOOK_URL is not set.");
  }
  const response = await fetch(webhookURL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to send Discord message: ${response.status}`);
  }
}

function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}