const { version, homepage } = require('../package.json');

const ADSB_LOL_URL = 'https://api.adsb.lol/v2/point';
// adsb.lol rejects generic user agents and asks for contact info
const USER_AGENT = `signalk-adsb/${version} (+${homepage})`;
const ADSB_LOL_MAX_RADIUS = 250; // nautical miles, API limit

function cleanFlight(flight) {
  return typeof flight === 'string' ? flight.replace(/\s/g, '') : '';
}

function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// dump1090 data.json: altitude in ft, speed in kt, track in degrees
function fromDump1090(adsb) {
  return {
    hex: adsb.hex,
    flight: cleanFlight(adsb.flight),
    lat: toNumber(adsb.lat),
    lon: toNumber(adsb.lon),
    altitude: toNumber(adsb.altitude),
    speed: toNumber(adsb.speed),
    track: toNumber(adsb.track),
    squawk: adsb.squawk,
  };
}

// adsb.lol v2 (readsb format): alt_baro is ft or the string "ground", gs in kt
function fromAdsbLol(ac) {
  let altitude = toNumber(ac.alt_baro);
  if (ac.alt_baro === 'ground') {
    altitude = 0;
  } else if (altitude === undefined) {
    altitude = toNumber(ac.alt_geom);
  }
  return {
    hex: ac.hex,
    flight: cleanFlight(ac.flight),
    lat: toNumber(ac.lat),
    lon: toNumber(ac.lon),
    altitude,
    speed: toNumber(ac.gs),
    track: toNumber(ac.track),
    squawk: ac.squawk,
  };
}

function toValues(aircraft) {
  const position = {
    latitude: aircraft.lat,
    longitude: aircraft.lon,
  };
  if (aircraft.altitude !== undefined) {
    position.altitude = aircraft.altitude * 0.3048; // Convert from ft to m
  }
  const values = [
    {
      path: '',
      value: {
        name: aircraft.flight || aircraft.hex,
      },
    },
    {
      path: 'navigation.position',
      value: position,
    },
    {
      path: 'communication.icao.hex',
      value: aircraft.hex,
    },
  ];
  if (aircraft.speed !== undefined) {
    values.push({
      path: 'navigation.speedOverGround',
      value: aircraft.speed * 0.5144444, // Convert from kt to m/s
    });
  }
  if (aircraft.track !== undefined) {
    values.push({
      path: 'navigation.courseOverGroundTrue',
      value: aircraft.track * (Math.PI / 180),
    });
  }
  if (aircraft.flight) {
    values.push({
      path: 'communication.callsignVhf',
      value: aircraft.flight,
    });
  }
  if (aircraft.squawk) {
    values.push({
      path: 'communication.squawk',
      value: aircraft.squawk,
    });
  }
  return values;
}

module.exports = (app) => {
  const plugin = {};
  plugin.id = 'signalk-adsb';
  plugin.name = 'ADS-B';
  plugin.description = 'Receive aircraft via ADS-B into Signal K';
  let interval;

  function fetchJson(url, options) {
    return fetch(url, options)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Request failed with HTTP ${response.status}`);
        }
        return response.json();
      });
  }

  function fetchDump1090(settings) {
    const host = settings.host || '127.0.0.1';
    const port = settings.port || 8080;
    return fetchJson(`http://${host}:${port}/dump1090/data.json`)
      .then((data) => ({
        aircraft: Array.isArray(data) ? data.map(fromDump1090) : [],
        src: `${host}:${port}`,
        via: 'via ADS-B',
      }));
  }

  function fetchAdsbLol(settings) {
    const own = app.getSelfPath('navigation.position');
    const position = own && own.value ? own.value : own;
    if (!position
      || toNumber(position.latitude) === undefined
      || toNumber(position.longitude) === undefined) {
      return Promise.resolve(null);
    }
    const radius = Math.min(Math.max(Math.round(settings.radius || 50), 1), ADSB_LOL_MAX_RADIUS);
    const url = `${ADSB_LOL_URL}/${position.latitude.toFixed(3)}/${position.longitude.toFixed(3)}/${radius}`;
    return fetchJson(url, { headers: { 'User-Agent': USER_AGENT } })
      .then((data) => ({
        aircraft: data && Array.isArray(data.ac) ? data.ac.map(fromAdsbLol) : [],
        src: 'adsb.lol',
        via: `from adsb.lol within ${radius} NM`,
      }));
  }

  function poll(settings) {
    const request = settings.source === 'adsb.lol' ? fetchAdsbLol(settings) : fetchDump1090(settings);
    return request
      .then((result) => {
        if (!result) {
          app.setPluginStatus('Waiting for own vessel position');
          return;
        }
        app.debug(result);
        // Aircraft without a position fix can't be shown on a chart
        const aircraft = result.aircraft
          .filter((a) => a.hex && a.lat !== undefined && a.lon !== undefined);
        if (!aircraft.length) {
          app.setPluginStatus(`Not receiving aircraft ${result.via}`);
          return;
        }
        aircraft.forEach((a) => {
          app.handleMessage('signalk-adsb', {
            context: `aircraft.urn:mrn:icao:hex:${a.hex}`,
            updates: [
              {
                source: {
                  label: 'signalk-adsb',
                  src: result.src,
                },
                timestamp: new Date().toISOString(),
                values: toValues(a),
              },
            ],
          });
        });
        app.setPluginStatus(`Receiving ${aircraft.length} aircraft ${result.via}`);
      })
      .catch((err) => {
        app.debug(err);
        app.setPluginError(err.message);
      });
  }

  plugin.start = (settings) => {
    const ms = settings.interval ? settings.interval * 1000 : 10000;
    interval = setInterval(() => poll(settings), ms);
  };

  plugin.stop = () => {
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
  };

  // Exposed for tests
  plugin.poll = poll;

  plugin.schema = {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['dump1090', 'adsb.lol'],
        enumNames: ['Local receiver (dump1090)', 'Internet (adsb.lol)'],
        default: 'dump1090',
        title: 'Aircraft data source',
        description: 'Read a local ADS-B receiver, or fetch aircraft around the vessel from the free adsb.lol service (needs internet access)',
      },
      host: {
        type: 'string',
        default: '127.0.0.1',
        title: 'dump1090 host',
        description: 'Address of the computer running dump1090',
      },
      port: {
        type: 'integer',
        default: 8080,
        title: 'dump1090 port',
        description: 'Port used for dump1090',
      },
      radius: {
        type: 'integer',
        default: 50,
        minimum: 1,
        maximum: ADSB_LOL_MAX_RADIUS,
        title: 'adsb.lol radius (in nautical miles)',
        description: 'Fetch aircraft within this distance of the vessel position (adsb.lol only, max 250)',
      },
      interval: {
        type: 'integer',
        default: 10,
        title: 'Polling interval (in seconds)',
        description: 'How often to fetch the aircraft data',
      },
    },
  };

  return plugin;
};
