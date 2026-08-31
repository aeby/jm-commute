# Data sources and terms

This notice applies to the data embedded in `@jobmate/commute`. The package's
original software is licensed separately under the MIT License. Keep this file
with redistributed copies of the data.

## Road travel-time matrix

The road matrix was calculated with OSRM from OpenStreetMap data.

Attribution: **© OpenStreetMap contributors**

OpenStreetMap data is available under the Open Data Commons Open Database
License (ODbL) 1.0. The road matrix is derived from that data and is made
available under the ODbL 1.0. Redistribution and public use must retain the
attribution and comply with the ODbL.

- OpenStreetMap copyright and license: https://www.openstreetmap.org/copyright
- ODbL 1.0 text: https://opendatacommons.org/licenses/odbl/1-0/
- Attribution guidance: https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
- OSRM: https://project-osrm.org/

The packaged `data/road/manifest.json` records the source fingerprint,
generation date, routing engine version, profile, and algorithm for the exact
matrix in a release.

## Public-transport travel-time matrix

The public-transport matrix was calculated from the Swiss GTFS timetable feed
published by Geschäftsstelle Systemaufgaben Kundeninformation (SBB AG) through
the Open Data Platform Mobility Switzerland.

Required source attribution: **Raw data obtained from
https://opentransportdata.swiss/**

- GTFS dataset documentation: https://opentransportdata.swiss/en/cookbook/timetable-cookbook/gtfs/
- Open-data terms of use: https://opentransportdata.swiss/en/terms-of-use/

Those terms permit preparation, analysis, and publication of the data, require
the source URL in publications and analyses, and require regular refreshes in
line with the raw-data update cycle. This npm package is a dated snapshot, so
maintainers must publish refreshed versions as appropriate and consumers must
not treat it as a live timetable.

The packaged `data/public_transport/manifest.json` identifies the feed version,
representative service date, morning window, generation date, and matrix
fingerprint for the exact matrix in a release.

## Locality index

Locality names, postal codes, and coordinates are derived from the Official
Directory of Towns and Cities published by the Federal Office of Topography.

Required source attribution: **Bundesamt für Landestopografie swisstopo**

- Dataset: https://www.swisstopo.admin.ch/en/official-directory-of-towns-and-cities
- Terms for free geodata and geoservices: https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices

The swisstopo terms permit use, modification, redistribution, and commercial
use, with source attribution required.
