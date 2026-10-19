const {
  describe, it, beforeEach, afterEach,
} = require('node:test');
const assert = require('node:assert/strict');

const pluginFactory = require('../plugin/index');

function makeApp(position) {
  const app = {
    messages: [],
    status: null,
    pluginError: null,
    debug: () => {},
    error: () => {},
    getSelfPath: () => position,
    handleMessage: (id, delta) => app.messages.push(delta),
    setPluginStatus: (msg) => { app.status = msg; },
    setPluginError: (msg) => { app.pluginError = msg; },
  };
  return app;
}

function valueOf(delta, path) {
  const found = delta.updates[0].values.find((v) => v.path === path);
  return found ? found.value : undefined;
}

describe('aircraft sources', () => {
  const originalFetch = global.fetch;
  let requested;
  let lastOptions;

  function mockFetch(body, status = 200) {
    global.fetch = (url, options) => {
      requested.push(url);
      lastOptions = options;
      return Promise.resolve({
        ok: status === 200,
        status,
        json: () => Promise.resolve(body),
      });
    };
  }

  beforeEach(() => {
    requested = [];
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reads dump1090 data.json by default', async () => {
    mockFetch([
      {
        hex: '4ca7b5', flight: 'RYR12AB ', lat: 38.9, lon: 1.4, altitude: 10000, speed: 300, track: 90, squawk: '2000',
      },
    ]);
    const app = makeApp();
    await pluginFactory(app).poll({ host: '10.0.0.5', port: 8080 });
    assert.deepEqual(requested, ['http://10.0.0.5:8080/dump1090/data.json']);
    assert.equal(app.messages.length, 1);
    const delta = app.messages[0];
    assert.equal(delta.context, 'aircraft.urn:mrn:icao:hex:4ca7b5');
    assert.deepEqual(valueOf(delta, ''), { name: 'RYR12AB' });
    assert.equal(valueOf(delta, 'navigation.position').altitude, 3048);
    assert.ok(Math.abs(valueOf(delta, 'navigation.speedOverGround') - 154.33) < 0.01);
    assert.ok(Math.abs(valueOf(delta, 'navigation.courseOverGroundTrue') - Math.PI / 2) < 1e-9);
    assert.equal(valueOf(delta, 'communication.callsignVhf'), 'RYR12AB');
    assert.equal(app.status, 'Receiving 1 aircraft via ADS-B');
  });

  it('does not fail the whole batch on an aircraft without callsign', async () => {
    mockFetch([
      {
        hex: 'aaaaaa', lat: 38.9, lon: 1.4, altitude: 5000, speed: 200, track: 10,
      },
      {
        hex: 'bbbbbb', flight: 'IBE1 ', lat: 39.0, lon: 1.5, altitude: 6000, speed: 210, track: 20,
      },
    ]);
    const app = makeApp();
    await pluginFactory(app).poll({});
    assert.equal(app.pluginError, null);
    assert.equal(app.messages.length, 2);
    assert.deepEqual(valueOf(app.messages[0], ''), { name: 'aaaaaa' });
    assert.equal(valueOf(app.messages[0], 'communication.callsignVhf'), undefined);
  });

  it('fetches adsb.lol around the vessel position', async () => {
    mockFetch({
      ac: [
        {
          hex: '346182', flight: 'ANE70JF ', lat: 38.71, lon: 1.653, alt_baro: 9975, gs: 274, track: 66.33, squawk: '6315',
        },
        {
          hex: '3443c1', flight: 'VLG2AB  ', lat: 38.87, lon: 1.37, alt_baro: 'ground', gs: 12, track: 240,
        },
        // No position fix: skipped
        { hex: '345000', flight: 'NOPOS' },
      ],
    });
    const app = makeApp({ value: { latitude: 38.9812, longitude: 1.5304 } });
    await pluginFactory(app).poll({ source: 'adsb.lol', radius: 80 });
    assert.deepEqual(requested, ['https://api.adsb.lol/v2/point/38.981/1.530/80']);
    // adsb.lol answers 403 to generic user agents
    assert.match(lastOptions.headers['User-Agent'], /^signalk-adsb\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/meri-imperiumi\/signalk-adsb/);
    assert.equal(app.messages.length, 2);
    assert.equal(app.messages[0].updates[0].source.src, 'adsb.lol');
    assert.ok(Math.abs(valueOf(app.messages[0], 'navigation.position').altitude - 3040.38) < 0.01);
    assert.equal(valueOf(app.messages[1], 'navigation.position').altitude, 0);
    assert.equal(app.status, 'Receiving 2 aircraft from adsb.lol within 80 NM');
  });

  it('caps the adsb.lol radius at the API limit', async () => {
    mockFetch({ ac: [] });
    const app = makeApp({ latitude: 38.98, longitude: 1.53 });
    await pluginFactory(app).poll({ source: 'adsb.lol', radius: 1000 });
    assert.deepEqual(requested, ['https://api.adsb.lol/v2/point/38.980/1.530/250']);
    assert.equal(app.status, 'Not receiving aircraft from adsb.lol within 250 NM');
  });

  it('waits for the vessel position before using adsb.lol', async () => {
    mockFetch({ ac: [] });
    const app = makeApp(undefined);
    await pluginFactory(app).poll({ source: 'adsb.lol' });
    assert.deepEqual(requested, []);
    assert.equal(app.status, 'Waiting for own vessel position');
  });

  it('reports HTTP errors', async () => {
    mockFetch({}, 503);
    const app = makeApp({ latitude: 38.98, longitude: 1.53 });
    await pluginFactory(app).poll({ source: 'adsb.lol' });
    assert.equal(app.pluginError, 'Request failed with HTTP 503');
  });
});
