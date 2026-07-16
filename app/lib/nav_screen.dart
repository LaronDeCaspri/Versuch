import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'services.dart';

const _go = Color(0xFF25E39A);
const _warn = Color(0xFFFF4D5E);
const _panel = Color(0xF20C1426);

class NavScreen extends StatefulWidget {
  const NavScreen({super.key});
  @override
  State<NavScreen> createState() => _NavScreenState();
}

class _NavScreenState extends State<NavScreen> {
  final MapController _map = MapController();
  final TextEditingController _search = TextEditingController();
  final FlutterTts _tts = FlutterTts();
  final Distance _distance = const Distance();

  StreamSubscription<Position>? _posSub;
  LatLng? _pos;
  double _speedKmh = 0, _heading = 0;
  String _status = 'Standort wird gesucht …';

  RouteResult? _route;
  List<double> _cum = [0];
  int _nextMan = 0;
  final Set<int> _spoken = {};
  bool _navigating = false, _follow = true;
  List<Map<String, dynamic>> _suggest = [];
  Timer? _suggestTimer;

  static const _manDe = {
    'right': 'Rechts abbiegen', 'left': 'Links abbiegen', 'slightRight': 'Leicht rechts',
    'slightLeft': 'Leicht links', 'uturn': 'Wenden', 'straight': 'Geradeaus',
    'depart': 'Losfahren', 'arrive': 'Ziel erreicht',
  };

  @override
  void initState() {
    super.initState();
    _tts.setLanguage('de-DE');
    _tts.setSpeechRate(0.95);
    _initLocation();
  }

  @override
  void dispose() {
    _posSub?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _initLocation() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        setState(() => _status = 'Bitte Standortdienste aktivieren');
        return;
      }
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        setState(() => _status = 'Standort-Berechtigung nötig');
        return;
      }
      final p = await Geolocator.getCurrentPosition();
      _applyPosition(p, center: true);
      _posSub = Geolocator.getPositionStream(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 4),
      ).listen((p) => _applyPosition(p));
    } catch (e) {
      setState(() => _status = 'Kein GPS: $e');
    }
  }

  void _applyPosition(Position p, {bool center = false}) {
    final ll = LatLng(p.latitude, p.longitude);
    setState(() {
      _pos = ll;
      _speedKmh = (p.speed.isFinite && p.speed > 0) ? p.speed * 3.6 : 0;
      if (p.heading.isFinite) _heading = p.heading;
      _status = '';
    });
    if (center) _map.move(ll, 16);
    if (_navigating) {
      if (_follow) _map.move(ll, _map.camera.zoom);
      _updateGuidance(ll);
    }
  }

  // ---- Route berechnen ----
  Future<void> _computeRoute(LatLng to) async {
    if (_pos == null) return;
    setState(() => _status = 'Route wird berechnet …');
    final r = await NavService.route(_pos!, to);
    if (r == null) {
      setState(() => _status = 'Keine Route gefunden');
      return;
    }
    _cum = [0];
    for (var i = 0; i < r.points.length - 1; i++) {
      _cum.add(_cum[i] + _distance.as(LengthUnit.Meter, r.points[i], r.points[i + 1]));
    }
    setState(() {
      _route = r;
      _nextMan = 0;
      _spoken.clear();
      _status = '';
    });
    _fitRoute(r.points);
  }

  void _fitRoute(List<LatLng> pts) {
    if (pts.isEmpty) return;
    _map.fitCamera(CameraFit.bounds(
      bounds: LatLngBounds.fromPoints(pts),
      padding: const EdgeInsets.fromLTRB(40, 120, 40, 220),
    ));
  }

  int _nearestIndex(LatLng ll) {
    if (_route == null) return 0;
    var best = 0;
    double bd = double.infinity;
    for (var i = 0; i < _route!.points.length; i++) {
      final d = _distance.as(LengthUnit.Meter, ll, _route!.points[i]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  double _remainingMeters(LatLng ll) {
    if (_route == null) return 0;
    final i = _nearestIndex(ll);
    return (_route!.distance - _cum[i]).clamp(0, _route!.distance);
  }

  void _updateGuidance(LatLng ll) {
    final r = _route;
    if (r == null || r.maneuvers.isEmpty) return;
    // nächstes Manöver bestimmen
    while (_nextMan < r.maneuvers.length - 1 &&
        _distance.as(LengthUnit.Meter, ll, r.maneuvers[_nextMan].location) < 25) {
      _nextMan++;
    }
    final man = r.maneuvers[_nextMan];
    final d = _distance.as(LengthUnit.Meter, ll, man.location);
    final instr = _manDe[man.key] ?? '';
    // mehrstufige Ansage
    if (d < 60 && !_spoken.contains(_nextMan * 10 + 3)) {
      _spoken.add(_nextMan * 10 + 3);
      _tts.speak('Jetzt $instr');
    } else if (d < 250 && !_spoken.contains(_nextMan * 10 + 2)) {
      _spoken.add(_nextMan * 10 + 2);
      _tts.speak('In ${_round(d)} Metern $instr');
    } else if (d < 700 && !_spoken.contains(_nextMan * 10 + 1)) {
      _spoken.add(_nextMan * 10 + 1);
      _tts.speak('In ${_round(d)} Metern $instr');
    }
    setState(() {});
    if (_remainingMeters(ll) < 25) _arrive();
  }

  int _round(double m) => (m / 10).round() * 10;

  void _arrive() {
    setState(() => _navigating = false);
    _tts.speak('Ziel erreicht');
  }

  void _startStop() {
    if (_route == null) return;
    setState(() {
      _navigating = !_navigating;
      _follow = true;
    });
    if (_navigating) {
      _tts.speak('Route gestartet');
      if (_pos != null) { _map.move(_pos!, 17); _updateGuidance(_pos!); }
    }
  }

  Future<void> _doSearch() async {
    final q = _search.text.trim();
    if (q.isEmpty) return;
    FocusScope.of(context).unfocus();
    setState(() { _suggest = []; _status = 'Suche …'; });
    final to = await NavService.geocode(q);
    if (to == null) { setState(() => _status = 'Ort nicht gefunden'); return; }
    await _computeRoute(to);
  }

  void _onSearchChanged(String v) {
    _suggestTimer?.cancel();
    _suggestTimer = Timer(const Duration(milliseconds: 400), () async {
      final s = await NavService.suggest(v);
      if (mounted) setState(() => _suggest = s);
    });
  }

  // ---- UI ----
  @override
  Widget build(BuildContext context) {
    final center = _pos ?? const LatLng(24.7136, 46.6753); // Riad als Fallback
    return Scaffold(
      backgroundColor: const Color(0xFF0A1122),
      body: Stack(children: [
        FlutterMap(
          mapController: _map,
          options: MapOptions(
            initialCenter: center,
            initialZoom: 15,
            onPointerDown: (_, __) => setState(() => _follow = false),
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.masar.app',
            ),
            if (_route != null)
              PolylineLayer(polylines: [
                Polyline(points: _route!.points, strokeWidth: 9, color: const Color(0xAA0C8F63)),
                Polyline(points: _route!.points, strokeWidth: 6, color: _go),
              ]),
            if (_pos != null)
              MarkerLayer(markers: [
                Marker(
                  point: _pos!, width: 30, height: 30,
                  child: Transform.rotate(
                    angle: _heading * 3.14159265 / 180,
                    child: Stack(alignment: Alignment.center, children: [
                      Container(
                        decoration: BoxDecoration(
                          color: const Color(0xFF2B83FF), shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 3),
                          boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 6)],
                        ),
                      ),
                      const Positioned(
                        top: 0,
                        child: Icon(Icons.navigation, color: Colors.white, size: 13),
                      ),
                    ]),
                  ),
                ),
              ]),
          ],
        ),

        // Oben: Suche oder Anweisung
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: _navigating ? _instructionCard() : _searchBar(),
          ),
        ),

        if (_status.isNotEmpty) _statusPill(),

        // Rechts: Zoom + Neu zentrieren
        SafeArea(
          child: Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.only(right: 10, bottom: 90),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                _roundBtn(Icons.add, () => _zoom(1)),
                const SizedBox(height: 8),
                _roundBtn(Icons.remove, () => _zoom(-1)),
                const SizedBox(height: 8),
                _roundBtn(_follow ? Icons.my_location : Icons.location_searching, _recenter,
                    tint: _follow ? _go : Colors.white),
              ]),
            ),
          ),
        ),

        // Unten: Tacho + Start/Stop
        SafeArea(
          child: Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: _bottomBar(),
            ),
          ),
        ),
      ]),
    );
  }

  Widget _searchBar() {
    return Column(children: [
      Material(
        color: _panel, borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(children: [
            const Icon(Icons.search, color: Colors.white70),
            Expanded(
              child: TextField(
                controller: _search,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  hintText: 'Wohin? (Adresse oder Ort)',
                  hintStyle: TextStyle(color: Colors.white38),
                  border: InputBorder.none,
                ),
                textInputAction: TextInputAction.search,
                onChanged: _onSearchChanged,
                onSubmitted: (_) => _doSearch(),
              ),
            ),
            if (_route != null)
              TextButton(onPressed: _startStop, child: const Text('Start', style: TextStyle(color: _go, fontWeight: FontWeight.bold))),
          ]),
        ),
      ),
      for (final s in _suggest)
        Material(
          color: const Color(0xFF0A1428),
          child: ListTile(
            dense: true,
            title: Text(s['display_name'] as String,
                maxLines: 2, overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white, fontSize: 13)),
            onTap: () {
              _search.text = (s['display_name'] as String).split(',').first;
              setState(() => _suggest = []);
              _computeRoute(LatLng(double.parse(s['lat'] as String), double.parse(s['lon'] as String)));
            },
          ),
        ),
    ]);
  }

  Widget _instructionCard() {
    final r = _route!;
    final man = r.maneuvers.isNotEmpty ? r.maneuvers[_nextMan] : null;
    final d = (man != null && _pos != null) ? _distance.as(LengthUnit.Meter, _pos!, man.location) : 0.0;
    return Material(
      color: _panel, borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(children: [
          Icon(_iconFor(man?.key ?? 'straight'), color: _go, size: 40),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text('${_round(d)} m',
                  style: const TextStyle(color: Colors.white, fontSize: 30, fontWeight: FontWeight.w800)),
              Text(man == null || man.name.isEmpty ? (_manDe[man?.key ?? 'straight'] ?? '')
                      : '${_manDe[man.key] ?? ''} · ${man.name}',
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white70, fontSize: 14, fontWeight: FontWeight.w600)),
            ]),
          ),
        ]),
      ),
    );
  }

  IconData _iconFor(String key) {
    switch (key) {
      case 'right': return Icons.turn_right;
      case 'left': return Icons.turn_left;
      case 'slightRight': return Icons.turn_slight_right;
      case 'slightLeft': return Icons.turn_slight_left;
      case 'uturn': return Icons.u_turn_left;
      case 'arrive': return Icons.flag;
      default: return Icons.straight;
    }
  }

  Widget _bottomBar() {
    final rem = _pos != null ? _remainingMeters(_pos!) : 0.0;
    final min = (rem / 1000 / 50 * 60).clamp(0, 999).round();
    return Row(children: [
      // Tacho
      Container(
        width: 72, height: 72,
        decoration: BoxDecoration(
          color: _panel, shape: BoxShape.circle,
          border: Border.all(color: _go, width: 3),
        ),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text('${_speedKmh.round()}',
              style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800)),
          const Text('km/h', style: TextStyle(color: Colors.white54, fontSize: 9)),
        ]),
      ),
      const Spacer(),
      if (_route != null)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(color: _panel, borderRadius: BorderRadius.circular(14)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.end, mainAxisSize: MainAxisSize.min, children: [
            Text(_navigating ? '$min Min' : '${(_route!.distance / 1000).toStringAsFixed(1)} km',
                style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
            Text('${(rem / 1000).toStringAsFixed(1)} km',
                style: const TextStyle(color: Colors.white54, fontSize: 12)),
          ]),
        ),
      const Spacer(),
      // Start/Stop
      FloatingActionButton(
        backgroundColor: _navigating ? _warn : _go,
        onPressed: _route == null ? null : _startStop,
        child: Icon(_navigating ? Icons.close : Icons.navigation, color: Colors.black),
      ),
    ]);
  }

  void _zoom(double d) => _map.move(_map.camera.center, (_map.camera.zoom + d).clamp(3.0, 19.0));

  void _recenter() {
    if (_pos == null) return;
    setState(() => _follow = true);
    _map.move(_pos!, _navigating ? 17 : 16);
  }

  Widget _roundBtn(IconData icon, VoidCallback onTap, {Color tint = Colors.white}) {
    return Material(
      color: _panel, shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(11),
          child: Icon(icon, color: tint, size: 22),
        ),
      ),
    );
  }

  Widget _statusPill() {
    return Align(
      alignment: Alignment.center,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(color: _panel, borderRadius: BorderRadius.circular(12)),
        child: Text(_status, style: const TextStyle(color: Colors.white, fontSize: 13)),
      ),
    );
  }
}
