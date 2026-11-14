# Data sources and licences

Every dataset the app shows or the pipeline reads, with its credit line. No agency named here has reviewed or endorsed this prototype.

## NASA

| Data | Used for | Access | Credit |
|---|---|---|---|
| NISAR L2 GCOV, PROVISIONAL V1 (`NISAR_L2_GCOV_PROVISIONAL_V1`) | Kedah HH/HV, passes before 21 Oct 2026 | ASF DAAC, Earthdata Login | NASA/JPL, via ASF DAAC, doi:10.5067/NIL2GCOV-P1 |
| NISAR L2 GCOV, Validated V1 (`NISAR_L2_GCOV_V1`) | Kedah 31 Oct 2026; live checks | ASF DAAC, Earthdata Login | NASA/JPL, via ASF DAAC, doi:10.5067/NIL2GCOV-V1 |
| NISAR GCOV browse images | "Newest NISAR picture" layer | ASF Search API, public | NASA/JPL, via ASF DAAC |
| OPERA RTC-S1 V1 | Kelantan VV brightness and flood classes | ASF DAAC, Earthdata Login | OPERA RTC-S1 V1, NASA JPL, via ASF DAAC, doi:10.5067/SNWG/OPERA_L2_RTC-S1_V1. Contains modified Copernicus Sentinel data 2024 |
| OPERA DSWx-S1 V1 | Agreement scores, disagreement map, NASA water-map layers | PO.DAAC, Earthdata Login; GIBS pictures | OPERA. 2024. OPERA Dynamic Surface Water Extent from Sentinel-1 product (Version 1). PO.DAAC, CA, USA. doi:10.5067/OPDSWS1-L3V1. Contains modified Copernicus Sentinel data 2024/2026 |
| GIBS pictures (VIIRS true colour, NISAR GCOV, OPERA DSWx-S1, OPERA RTC-S1) | Picture layers | GIBS WMTS/WMS, public | We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS) |
| CMR and ASF Search API | Pass dates and live checks | public | NASA Common Metadata Repository; Alaska Satellite Facility DAAC |
| NASA POWER daily precipitation (PRECTOTCORR, MERRA-2 reanalysis, bias-corrected) | Rainfall chart (study-box average of 4 points) | power.larc.nasa.gov, public, no login | Data from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program |
| NASA GPM IMERG daily V07 (planned) | Rainfall chart, when the pipeline can reach GES DISC | GES DISC, Earthdata Login + GES DISC app approval | Huffman, G.J., et al., GPM IMERG Final/Late Precipitation L3 1 day V07, GES DISC, doi:10.5067/GPM/IMERGDF/DAY/07 |

NASA data are free to use with credit ([NASA Earthdata data use policy](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance)).

## Other sources

| Data | Used for | Licence and credit |
|---|---|---|
| EC JRC Global Surface Water 1984–2021 (occurrence) | Normal-water mask, context layer | Source: EC JRC/Google. Pekel, Cottam, Gorelick, Belward (2016), Nature 540, 418–422, doi:10.1038/nature20584 |
| ESA WorldCover 2021 v200 | Cropland and built-up masks, sea mask | CC BY 4.0. © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium |
| DOSM district boundaries | District numbers and borders | Department of Statistics Malaysia (DOSM), data-open, DOSM Open Data License (`public/data/DOSM_LICENSE.md`). Not endorsed by DOSM |
| OpenFreeMap basemap | Basemap | © OpenMapTiles, data © OpenStreetMap contributors (ODbL) |
| News and MADA facts | Context cards | Malay Mail, The Star, Bernama, NST, DOSM special report, MADA notice of 14 Sep 2026 (quoted with links) |

## Learning resources linked in the app (not used as data)

NASA Earthdata SAR basics and Earth observation data basics, NASA ARSET, NISAR StoryMaps and societal-benefit overviews (NASA/JPL, 2017), UAVSAR postcards (JPL; linked only, no images copied), ASF NISAR data guide, Earthdata Search, ASF Vertex.

Checked and not used: RADARSAT Constellation Mission open data (Canada only), RADARSAT-1 archive (no scenes over Kelantan at ASF), SAOCOM (downloads need a CONAE agreement).
