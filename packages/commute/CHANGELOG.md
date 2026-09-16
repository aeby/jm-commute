# Changelog

## 0.2.0

- Select only stations with boardable service during the configured morning window.
- Improve station selection using service frequency, a rail bonus, and a nearest active station fallback.
- Expose the selected station name as `Locality.publicTransportStationName`.
- Refresh GTFS, OpenStreetMap, and locality data.

## 0.1.0

- Initial release with precomputed road and public-transport travel times between Swiss localities.
