import { URL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import * as dotenv from 'dotenv';
import got from 'got';
import { scheduleJob } from 'node-schedule';
import { load } from 'cheerio';
import { parseDocument } from 'htmlparser2';
import { writeToPath } from '@fast-csv/format';

dotenv.config();

const fileName = `report-${Date.now()}.csv`;
const rows = [['url', 'passed', 'referer', 'details', 'code']];

const START_URL = 'some-url';
const domains = ['one', 'two'];
const WAIT_BETWEEN = 300;
// path, selector, includesText
const checks = [];

const checkedUrls = [];

function runCheck($, check) {
  const result = $(check.selector);
  try {
    return result ? result.text().includes(check.includesText) : false;
  } catch (e) {
    return false;
  }
}

async function process(path, referer) {
  if (!keepPath(path)) {
    return;
  }
  console.info(`Processing: ${path}...`);

  try {
    const response = await got.get(path);
    const dom = parseDocument(response.body.toString());
    const $ = load(dom);
    const check = checks.find((c) => path.match(c.path));
    const checkResult = check ? runCheck($, check) : undefined;
    const result = { url: path, passed: !check || checkResult };

    if (referer) {
      result.referer = referer;
    }
    if (checkResult === false) {
      result.details = 'Failed check';
    }

    checkedUrls.push(result);

    // do not drill through the whole internet
    if (!referer || allowedByDomains(referer)) {
      const newReferer = new URL(path);
      const links = getLinks($, newReferer.origin);

      for (const link of links) {
        if (WAIT_BETWEEN) {
          await setTimeout(WAIT_BETWEEN);
        }

        await process(link, path);
      }
    }
  } catch (e) {
    const result = { url: path, passed: false };
    if (e.code) {
      result.code = e.code;
    }
    if (e.message) {
      result.details = e.message;
    }
    if (referer) {
      result.referer = referer;
    }
    checkedUrls.push(result);
  }
}

function keepPath(path) {
  const safePath = path.trim();
  return !checkedUrls.find((c) => c.url === safePath);
}

function allowedByDomains(url) {
  return domains.length ? domains.some((d) => url.startsWith(d)) : true;
}

function getLinks($, referer) {
  const $a = $('a');
  const attributeFilter = (a) => a.name === 'href';
  const urls = Array.from($a)
    .filter((a) => a.attributes.find(attributeFilter))
    .map((a) => a.attributes.find(attributeFilter).value.trim())
    .filter(v => !v.startsWith('mailto:'))
    .map((u) =>
      u.match(/^http(s)?:\/\//)
        ? u
        : (referer || START_URL).replace(/\/+$/, '').trim() + '/' + u.replace(/^\/+/, '').trim(),
    );
  const filteredUrls = Array.from(new Set(urls.filter(keepPath)));

  if (domains.length) {
    return filteredUrls.filter(allowedByDomains);
  }
  return filteredUrls;
}

await process(START_URL);

rows.push(...checkedUrls.map((u) => [u.url, u.passed, u.referer || '', u.details || '', u.code || '']));

writeToPath(fileName, rows)
  .on('error', (err) => console.error(err))
  .on('finish', () => console.log('Done writing.'));

// const everyTenSeconds = scheduleJob('*/10 * * * * *', () => {
//     console.log('The answer to life, the universe, and everything!');
// });
