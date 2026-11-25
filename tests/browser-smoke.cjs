const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const script = readFileSync(join(__dirname, '..', 'sirgon-globe.js'));
  const server = createServer((req, res) => {
    if (req.url === '/sirgon-globe.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(script);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><body><script src="/sirgon-globe.js"></script></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => {
      const today = new Date().toISOString();
      const daily = [{ datetime: today, condition: 'cloudy', temperature: 25, templow: 10 }];
      const hourly = [{ datetime: today, condition: 'cloudy', temperature: 21 }];
      const hass = {
        states: {
          'weather.home': { entity_id: 'weather.home', state: 'cloudy', attributes: { friendly_name: 'Orlando', temperature: 20, temperature_unit: '°C', humidity: 80, apparent_temperature: 19, supported_features: 3 } },
          'weather.other': { entity_id: 'weather.other', state: 'cloudy', attributes: { friendly_name: 'Other', temperature: 68, temperature_unit: '°F', supported_features: 3 } },
          'sensor.clock': { entity_id: 'sensor.clock', state: '21:05', attributes: { friendly_name: 'Clock' } },
          'sensor.local_temperature': { entity_id: 'sensor.local_temperature', state: '68', attributes: { unit_of_measurement: '°F' } }
        },
        config: { latitude: 28.5, longitude: -81.4, unit_system: { temperature: '°C' } },
      };
      const config = { type: 'custom:sirgon-globe', entity: 'weather.home', temperature_unit: 'F', show_clock: true, local_time: 'sensor.clock', animation_speed: 0 };
      function makeCard(id, overrides, width) {
        const card = document.createElement('sirgon-globe');
        card.id = id;
        card.style.width = `${width}px`;
        card.style.margin = '8px';
        // Keep this a deterministic layout/interaction test; atmospheric canvas
        // and particle effects are exercised separately in a live HA instance.
        card._startCanvas = () => {};
        card._injectParticlesAsync = () => {};
        card._initDetSplash = () => {};
        card._initUfo = () => {};
        card._destroyUfo = () => {};
        card._hass = hass;
        card.setConfig({ ...config, ...overrides });
        document.body.append(card);
        card._buildShell();
        card._initialized = true;
        card._forecast = daily;
        card._modalForecast = hourly;
        card._renderContent();
        return card;
      }
      makeCard('compact', { compact_mode: true, show_both_units: true }, 260);
      makeCard('normal', { show_both_units: true }, 320);
      makeCard('legacy', {}, 320);
      makeCard('narrow', { compact_mode: true, show_both_units: true, temperature_unit: 'C' }, 190);
      makeCard('local', { compact_mode: true, show_both_units: true, local_weather_station: true, local_temperature: 'sensor.local_temperature' }, 260);
      const editor = document.createElement('sirgon-globe-editor');
      editor.id = 'editor';
      editor.hass = hass;
      editor.setConfig(config);
      document.body.append(editor);
      editor.addEventListener('config-changed', event => { window.savedConfig = event.detail.config; });
    });

    const compact = page.locator('#compact');
    const normal = page.locator('#normal');
    const legacy = page.locator('#legacy');
    const narrow = page.locator('#narrow');
    const local = page.locator('#local');
    const summary = async card => (await card.locator('.tmp').innerText()).replace(/\s+/g, '');
    assert.equal(await summary(compact), '68°F20°C');
    assert.equal(await summary(normal), '68°F20°C');
    assert.equal(await summary(legacy), '68°');
    assert.equal(await summary(narrow), '20°C68°F');
    assert.equal(await summary(local), '68°F20°C');
    assert.match(await compact.locator('.hl').innerText(), /77°F\s*\/\s*25°C/);
    assert.match(await compact.locator('.hl').innerText(), /50°F\s*\/\s*10°C/);
    assert.equal(await compact.locator('.compact-clock').innerText(), '21:05');
    assert.equal(await compact.locator('.det-wrap').count(), 0);
    assert.equal(await compact.locator('#fc-strip').count(), 0);
    assert.equal(await normal.locator('#fc-strip').count(), 1);
    assert.match(await normal.locator('#fc-strip').innerText(), /25°C/);
    assert.match(await normal.locator('.det').innerText(), /66°F\s*\/\s*19°C/);

    const sizes = await page.evaluate(() => {
      const bounds = id => document.getElementById(id).shadowRoot.getElementById('card').getBoundingClientRect();
      return { compact: bounds('compact').height, normal: bounds('normal').height, narrow: bounds('narrow').height, rows: document.getElementById('compact').getGridOptions().rows };
    });
    assert.equal(sizes.rows, 2);
    assert.ok(sizes.compact <= 120, JSON.stringify(sizes));
    assert.ok(sizes.narrow <= 150, JSON.stringify(sizes));
    assert.ok(sizes.compact < sizes.normal * 0.55, JSON.stringify(sizes));
    const noOverflow = await page.evaluate(() => {
      const root = document.getElementById('narrow').shadowRoot;
      return [...root.querySelectorAll('.tmp,.hl,.cn2')].every(el => el.scrollWidth <= el.clientWidth + 2);
    });
    assert.ok(noOverflow, 'Narrow card must not clip temperature or condition');

    const trigger = compact.locator('#compact-forecast-btn');
    const dialog = compact.locator('#compact-forecast-dialog');
    await trigger.click();
    assert.equal(await dialog.evaluate(el => el.open), true);
    assert.match(await dialog.locator('.compact-forecast-rows').innerText(), /25°C/);
    assert.match(await dialog.locator('.compact-forecast-rows').innerText(), /10°C/);
    await dialog.locator('[data-compact-forecast-type="hourly"]').click();
    assert.match(await dialog.locator('.compact-forecast-rows').innerText(), /70°F/);
    assert.match(await dialog.locator('.compact-forecast-rows').innerText(), /21°C/);
    assert.equal(await dialog.locator('[data-compact-forecast-type="hourly"]').getAttribute('aria-pressed'), 'true');

    await page.evaluate(() => document.getElementById('compact')._renderContent());
    assert.equal(await dialog.evaluate(el => el.open), true);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert.match(await dialog.locator('.compact-forecast-rows').innerText(), /21°C/);
    const heightOpen = await compact.locator('#card').evaluate(el => el.getBoundingClientRect().height);
    assert.equal(heightOpen, sizes.compact);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await trigger.click();
    await dialog.locator('#compact-forecast-close').click();
    await dialog.waitFor({ state: 'hidden' });

    const editor = page.locator('#editor');
    assert.equal(await editor.locator('#show_both_units').isChecked(), false);
    await editor.locator('#show_both_units').evaluate(el => {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal(await page.evaluate(() => window.savedConfig.show_both_units), true);
    await page.evaluate(() => {
      const editor = document.getElementById('editor');
      editor.setConfig(window.savedConfig);
    });
    assert.equal(await editor.locator('#show_both_units').isChecked(), true);
    assert.deepEqual(errors, []);
    console.log('Browser smoke tests passed:', JSON.stringify(sizes));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
