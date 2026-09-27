/**
 * Scrape one page as markdown and print the balance.
 *
 *     DATAFUEL_API_KEY=df_key_... npx tsx examples/quickstart.ts https://example.com
 *
 * Set DATAFUEL_BASE_URL to try another environment, e.g.
 * https://scraping-api.staging.datafuel.ai/api/v1
 */

import * as datafuel from "../src/index.js";

async function main(): Promise<number> {
  const target = process.argv[2] ?? "https://example.com";
  const baseUrl = process.env.DATAFUEL_BASE_URL;
  const df = new datafuel.DataFuel(baseUrl ? { baseUrl } : {});

  try {
    const res = await df.scrape(target, { format: "markdown" });
    console.log(
      `status ${res.statusCode}, ${res.creditsUsed} credits, ${res.durationMs} ms, ` +
        `final url ${res.finalUrl}\n`,
    );
    console.log(res.text);
    console.log(`\nbalance: ${await df.balance()} credits`);
    return 0;
  } catch (error) {
    if (error instanceof datafuel.Blocked) {
      console.error(
        `blocked (status ${error.result.statusCode}, ${error.protection}): refunded, ` +
          "retry with jsRendering or a Premium proxy",
      );
      return 1;
    }
    if (error instanceof datafuel.DataFuelError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main();
