# Hybrid Roof Engine Integration

Source repository: `Fukkatsu85/instant-roof-estimator`

## Goal

Combine the strongest parts of both measurement systems into one roof model and one report.

## Data sources

### Solaris Measure
- Corrected property latitude/longitude
- MnGeo analysis imagery
- Accepted/manual aerial perimeter
- USGS 3DEP LiDAR point cloud
- LiDAR plane fitting
- R2 project persistence
- SVG/PDF-style report pipeline

### Instant Roof Estimator
- Google Solar Building Insights
- Google Solar rooftop mask
- Google Solar 0.1 m DSM
- Google Solar RGB raster
- Google roof segment pitch / azimuth / center metadata
- DSM facet segmentation
- Experimental ridge / hip / valley classification
- Eave / rake classification
- Multi-angle photo topology cross-check

## Integration rule

No single provider becomes the truth by itself.

The canonical Solaris roof model should preserve each source separately and then produce reviewed/verified values:

```js
{
  property: { address, lat, lng },
  outline: {
    acceptedPolygon,
    planAreaFt2,
    perimeterFt,
    sources: { mngeo, googleMask, lidar }
  },
  facets: [{
    polygon,
    planAreaFt2,
    slopedAreaFt2,
    pitch12,
    slopeDeg,
    azimuthDeg,
    sources: {
      lidarPlane,
      googleSolarSegment,
      googleDsm
    },
    confidence
  }],
  lines: [{
    type, // ridge | hip | valley | eave | rake
    a, b,
    lengthFt,
    sources: { dsm, lidar, manual },
    confidence,
    reviewed
  }],
  totals: {
    slopedAreaFt2,
    squares,
    ridgeFt,
    hipFt,
    valleyFt,
    eaveFt,
    rakeFt
  },
  validation: {
    googleSolarAreaFt2,
    lidarAreaFt2,
    areaDifferencePct,
    pitchAgreement,
    warnings: []
  }
}
```

## What to reuse from Instant Roof Estimator

Reuse:
- Solar API proxy routes
- GeoTIFF / projection handling
- rooftop-mask component extraction
- DSM slope sampling
- DSM facet detection
- shared-line extraction
- ridge / hip / valley classifier
- eave / rake classifier
- multi-view topology validation

Do not directly reuse:
- lead/pricing gate
- hard-coded roofing prices
- Noble-specific estimate form
- its standalone UI
- single-file application architecture

## Validation approach

For each roof compare:
1. accepted outline vs Google rooftop mask
2. Google whole-roof area vs Solaris calculated sloped area
3. Google segment pitch vs LiDAR plane pitch
4. Google/DSM facet count vs LiDAR facet count
5. DSM line classification vs reviewed aerial/LiDAR geometry

Disagreements should be shown in the review UI instead of silently choosing one source.

## Report target

The production report will use the canonical roof model and include:
- 2D vector roof diagram
- facet labels and pitches
- plan and sloped areas
- squares
- perimeter
- eave / rake
- ridge / hip / valley
- waste table
- measurement-source/confidence notes
- validation warnings when Google DSM and USGS LiDAR disagree materially
