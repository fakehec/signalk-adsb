# Changelog

## [Unreleased]
### Added
- Optional internet data sources for boats without an ADS-B receiver: fetch the aircraft around the vessel from [adsb.fi](https://adsb.fi) or [adsb.lol](https://adsb.lol)
- Radius choice (25 to 500 NM) and a separate internet refresh interval (30 seconds by default)
- Falls back to the other internet service while the selected one fails, and backs off after errors or HTTP 429

### Fixed
- An aircraft without a flight number no longer makes the whole update fail
- Aircraft without a position fix are skipped instead of being published without coordinates

## [1.0.2] - 2026-06-16
### Added
- Added app icon

## [1.0.1] - 2025-11-05
### Added
- Added transponder squawk

### Changed
- Removed whitespace from flight numbers

## [1.0.0] - 2025-11-05
### Changed
- Initial release

