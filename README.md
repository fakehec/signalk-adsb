Receive aircraft via ADS-B into Signal K
========================================

This plugin reads ADS-B aircraft data into Signal K, either from a local receiver running the [dump1090 software](https://github.com/antirez/dump1090), or from the free [adsb.lol](https://adsb.lol) network over the internet.

## Getting started

### With a local receiver

* Get an [RTL-SDR stick](https://www.rtl-sdr.com/about-rtl-sdr/) with [antenna suitable for 1090MHz](https://lucsmall.com/2017/02/06/making-antennas-for-1090mhz-ads-b-aircraft-tracking/) and plug it into a computer
* Install and run dump1090 with the `-net` option
* Install and enable this plugin
  - If dump1090 is running on a different computer than Signal K, configure the IP address used in the plugin accordingly
* (optional) Enable display of aircraft in Freeboard

### Without a receiver, from adsb.lol

* Install and enable this plugin, and set the data source to "Internet (adsb.lol)"
* Set the radius around the vessel to fetch aircraft for (up to 250 nautical miles)
* (optional) Enable display of aircraft in Freeboard

The plugin asks adsb.lol for the aircraft around the vessel's own position (`navigation.position`), so it needs a position fix and internet access. Data from adsb.lol is [ODbL](https://opendatacommons.org/licenses/odbl/summary/) licensed and comes from its community of feeders, so coverage depends on the area. Please keep the polling interval reasonable (the default 10 seconds is fine).

![Aircraft approaching SKCG as seen on Freeboard](https://github.com/meri-imperiumi/signalk-adsb/raw/main/doc/freeboard.png)

## Changes

See [Changelog](CHANGELOG.md)
