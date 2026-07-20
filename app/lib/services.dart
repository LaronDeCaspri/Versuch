import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

/// Eine Fahrspur an einer Kreuzung (aus OSRM „intersections.lanes").
class Lane {
  final bool valid;               // gehört diese Spur zur Route?
  final List<String> indications; // z. B. ["straight"], ["slight right"], ["left","through"]
  Lane(this.valid, this.indications);

  /// Pfeil-Richtung für die Anzeige.
  String get arrow {
    final ind = indications.isNotEmpty ? indications.last : 'straight';
    if (ind.contains('uturn')) return 'uturn';
    if (ind.contains('slight right')) return 'slightRight';
    if (ind.contains('slight left')) return 'slightLeft';
    if (ind.contains('sharp right') || ind == 'right') return 'right';
    if (ind.contains('sharp left') || ind == 'left') return 'left';
    return 'straight';
  }
}

/// Ein Abbiege-Manöver entlang der Route.
class Maneuver {
  final LatLng location;
  final double distanceAlong; // Meter ab Routenstart
  final String type;          // OSRM maneuver.type
  final String modifier;      // OSRM maneuver.modifier (right/left/…)
  final String name;          // Straßenname
  final List<Lane> lanes;     // Fahrspuren im Anlauf auf das Manöver
  Maneuver(this.location, this.distanceAlong, this.type, this.modifier, this.name, this.lanes);

  /// Vereinfachter Richtungs-Schlüssel für Icon/Ansage.
  String get key {
    if (type == 'arrive') return 'arrive';
    if (type == 'depart') return 'depart';
    final m = modifier;
    if (m.contains('uturn')) return 'uturn';
    if (m == 'sharp right' || m == 'right') return 'right';
    if (m == 'slight right') return 'slightRight';
    if (m == 'sharp left' || m == 'left') return 'left';
    if (m == 'slight left') return 'slightLeft';
    return 'straight';
  }
}

class RouteResult {
  final List<LatLng> points;
  final double distance; // Meter
  final double duration; // Sekunden
  final List<Maneuver> maneuvers;
  final List<int?> limits; // Tempolimit je Segment (km/h), null = unbekannt
  RouteResult(this.points, this.distance, this.duration, this.maneuvers, this.limits);
}

/// Ein Blitzer (Saher) aus OpenStreetMap.
class Camera {
  final LatLng location;
  final int? maxspeed; // km/h, falls bekannt
  Camera(this.location, this.maxspeed);
}

/// Gefahrenmeldung (Hazard) - Unfälle, Staus, Baustellen, Hindernisse
class Hazard {
  final LatLng location;
  final String type; // 'accident', 'slowTraffic', 'construction', 'debris'
  final String? description;
  final DateTime reported;
  Hazard(this.location, this.type, this.description, this.reported);
}

/// Segment einer Route mit erweiterten Informationen
class RouteSegment {
  final LatLng start;
  final LatLng end;
  final double distance; // Meter
  final double duration; // Sekunden
  final int? speedLimit; // km/h
  final String roadType; // 'motorway', 'trunk', 'primary', 'secondary', 'residential'
  RouteSegment(this.start, this.end, this.distance, this.duration, this.speedLimit, this.roadType);
}

/// Kostenlose Dienste: OSRM (Routing inkl. Spuren/Alternativen), Nominatim
/// (Adress-Suche) und Overpass (Blitzer) – alle OpenStreetMap.
class NavService {
  static const _ua = {'User-Agent': 'MasarNav/0.1 (prototype)'};

  static Future<LatLng?> geocode(String query) async {
    final uri = Uri.parse(
        'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${Uri.encodeComponent(query)}');
    final r = await http.get(uri, headers: _ua);
    if (r.statusCode != 200) return null;
    final list = jsonDecode(r.body) as List;
    if (list.isEmpty) return null;
    final m = list.first as Map;
    return LatLng(double.parse(m['lat'] as String), double.parse(m['lon'] as String));
  }

  static Future<List<Map<String, dynamic>>> suggest(String query) async {
    if (query.trim().length < 3) return [];
    final uri = Uri.parse(
        'https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${Uri.encodeComponent(query)}');
    final r = await http.get(uri, headers: _ua);
    if (r.statusCode != 200) return [];
    return (jsonDecode(r.body) as List).cast<Map<String, dynamic>>();
  }

  /// Haupt- und Alternativrouten (bis zu 3). Erste = schnellste.
  static Future<List<RouteResult>> routes(LatLng from, LatLng to) async {
    final uri = Uri.parse(
        'https://router.project-osrm.org/route/v1/driving/'
        '${from.longitude},${from.latitude};${to.longitude},${to.latitude}'
        '?overview=full&geometries=geojson&steps=true&alternatives=3&annotations=maxspeed');
    final r = await http.get(uri);
    if (r.statusCode != 200) return [];
    final j = jsonDecode(r.body) as Map;
    final routes = j['routes'] as List?;
    if (routes == null || routes.isEmpty) return [];
    return routes.map((rt) => _parseRoute(rt as Map)).toList();
  }

  static RouteResult _parseRoute(Map rt) {
    final coords = (rt['geometry']['coordinates'] as List)
        .map((c) => LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble()))
        .toList();
    final maneuvers = <Maneuver>[];
    final limits = <int?>[];
    double at = 0;
    final legs = rt['legs'] as List?;
    if (legs != null && legs.isNotEmpty) {
      // Tempolimits je Segment aus der maxspeed-Annotation.
      final ann = (legs.first as Map)['annotation'] as Map?;
      final ms = ann?['maxspeed'] as List?;
      if (ms != null) {
        for (final e in ms) {
          final m = e as Map;
          final sp = m['speed'];
          if (sp is num) {
            final unit = m['unit'];
            limits.add(unit == 'mph' ? (sp * 1.60934).round() : sp.round());
          } else {
            limits.add(null);
          }
        }
      }
      for (final st in (legs.first['steps'] as List)) {
        final man = st['maneuver'] as Map;
        final loc = man['location'] as List;
        // Fahrspuren aus den Kreuzungen dieses Schritts sammeln.
        final lanes = <Lane>[];
        final inters = st['intersections'] as List?;
        if (inters != null) {
          for (final it in inters) {
            final ln = (it as Map)['lanes'] as List?;
            if (ln != null) {
              lanes
                ..clear()
                ..addAll(ln.map((l) => Lane(
                      ((l as Map)['valid'] ?? false) as bool,
                      ((l['indications'] ?? const []) as List)
                          .map((e) => e.toString())
                          .toList(),
                    )));
            }
          }
        }
        maneuvers.add(Maneuver(
          LatLng((loc[1] as num).toDouble(), (loc[0] as num).toDouble()),
          at,
          (man['type'] ?? '') as String,
          (man['modifier'] ?? '') as String,
          (st['name'] ?? '') as String,
          lanes,
        ));
        at += (st['distance'] as num).toDouble();
      }
    }
    return RouteResult(coords, (rt['distance'] as num).toDouble(),
        (rt['duration'] as num).toDouble(), maneuvers, limits);
  }

  /// Echte Blitzer entlang der Route (OpenStreetMap via Overpass).
  static Future<List<Camera>> cameras(List<LatLng> route) async {
    if (route.isEmpty) return [];
    double minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
    for (final p in route) {
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
      if (p.longitude < minLon) minLon = p.longitude;
      if (p.longitude > maxLon) maxLon = p.longitude;
    }
    final q = '[out:json][timeout:25];'
        'node["highway"="speed_camera"]($minLat,$minLon,$maxLat,$maxLon);out;';
    final uri =
        Uri.parse('https://overpass-api.de/api/interpreter?data=${Uri.encodeComponent(q)}');
    try {
      final r = await http.get(uri, headers: _ua);
      if (r.statusCode != 200) return [];
      final els = (jsonDecode(r.body) as Map)['elements'] as List? ?? [];
      final cams = <Camera>[];
      const dist = Distance();
      for (final e in els) {
        final m = e as Map;
        final lat = (m['lat'] as num?)?.toDouble();
        final lon = (m['lon'] as num?)?.toDouble();
        if (lat == null || lon == null) continue;
        final ll = LatLng(lat, lon);
        // Nur Blitzer nahe der eigentlichen Route behalten (max. 80 m).
        var near = false;
        for (var i = 0; i < route.length; i += 3) {
          if (dist.as(LengthUnit.Meter, ll, route[i]) < 80) {
            near = true;
            break;
          }
        }
        if (!near) continue;
        int? mx;
        final tags = m['tags'] as Map?;
        final ms = tags?['maxspeed'];
        if (ms is String) mx = int.tryParse(ms.replaceAll(RegExp(r'[^0-9]'), ''));
        cams.add(Camera(ll, mx));
      }
      return cams;
    } catch (_) {
      return [];
    }
  }
}
