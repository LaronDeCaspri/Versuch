import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

/// Ein Abbiege-Manöver entlang der Route.
class Maneuver {
  final LatLng location;
  final double distanceAlong; // Meter ab Routenstart
  final String type;          // OSRM maneuver.type
  final String modifier;      // OSRM maneuver.modifier (right/left/…)
  final String name;          // Straßenname
  Maneuver(this.location, this.distanceAlong, this.type, this.modifier, this.name);

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
  RouteResult(this.points, this.distance, this.duration, this.maneuvers);
}

/// Kostenlose Dienste: OSRM (Routing) und Nominatim (Adress-Suche), beide OpenStreetMap.
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

  static Future<RouteResult?> route(LatLng from, LatLng to) async {
    final uri = Uri.parse(
        'https://router.project-osrm.org/route/v1/driving/'
        '${from.longitude},${from.latitude};${to.longitude},${to.latitude}'
        '?overview=full&geometries=geojson&steps=true');
    final r = await http.get(uri);
    if (r.statusCode != 200) return null;
    final j = jsonDecode(r.body) as Map;
    final routes = j['routes'] as List?;
    if (routes == null || routes.isEmpty) return null;
    final rt = routes.first as Map;
    final coords = (rt['geometry']['coordinates'] as List)
        .map((c) => LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble()))
        .toList();
    final maneuvers = <Maneuver>[];
    double at = 0;
    final legs = rt['legs'] as List?;
    if (legs != null && legs.isNotEmpty) {
      for (final st in (legs.first['steps'] as List)) {
        final man = st['maneuver'] as Map;
        final loc = man['location'] as List;
        maneuvers.add(Maneuver(
          LatLng((loc[1] as num).toDouble(), (loc[0] as num).toDouble()),
          at,
          (man['type'] ?? '') as String,
          (man['modifier'] ?? '') as String,
          (st['name'] ?? '') as String,
        ));
        at += (st['distance'] as num).toDouble();
      }
    }
    return RouteResult(coords, (rt['distance'] as num).toDouble(),
        (rt['duration'] as num).toDouble(), maneuvers);
  }
}
