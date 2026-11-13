/* Texas county map. No prices and no economics. */
(function (root) {
  'use strict';

  const BOUNDS = { lon0: -106.65, lon1: -93.5, lat0: 25.8, lat1: 36.55, w: 720, h: 640 };

  function project(lon, lat) {
    const x = (lon - BOUNDS.lon0) / (BOUNDS.lon1 - BOUNDS.lon0) * BOUNDS.w;
    const y = (BOUNDS.lat1 - lat) / (BOUNDS.lat1 - BOUNDS.lat0) * BOUNDS.h;
    return [x, y];
  }

  function ring(points) {
    let path = '';
    for (let i = 0; i < points.length; i++) {
      const xy = project(points[i][0], points[i][1]);
      path += (i ? 'L' : 'M') + xy[0].toFixed(1) + ' ' + xy[1].toFixed(1);
    }
    return path + 'Z';
  }

  function geometryPath(geometry) {
    if (!geometry) return '';
    if (geometry.type === 'Polygon') return geometry.coordinates.map(ring).join(' ');
    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.map(function (polygon) { return polygon.map(ring).join(' '); }).join(' ');
    }
    return '';
  }

  function draw(svg, geo, colorOf, onPick) {
    const ns = 'http://www.w3.org/2000/svg';
    svg.setAttribute('viewBox', '0 0 ' + BOUNDS.w + ' ' + BOUNDS.h);
    svg.replaceChildren();
    const features = (geo && geo.features) || [];
    features.forEach(function (feature) {
      const geoid = String(feature.properties.GEOID);
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', geometryPath(feature.geometry));
      path.setAttribute('data-geoid', geoid);
      path.setAttribute('fill', colorOf(geoid, feature));
      path.setAttribute('stroke', '#292826');
      path.setAttribute('stroke-width', '0.6');
      const name = feature.properties.NAME || geoid;
      path.appendChild(Object.assign(document.createElementNS(ns, 'title'), { textContent: name }));
      if (onPick) {
        path.addEventListener('click', function () { onPick(geoid, name); });
      }
      svg.appendChild(path);
    });
  }

  const api = { draw: draw, BOUNDS: BOUNDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SitingMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
