import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'services.dart';

const _go = Color(0xFF25E39A);
const _warn = Color(0xFFFF4D5E);
const _panel = Color(0xF20C1426);
const _grey = Color(0x998890A8);

/// Kartenansichten, die der Umschalt-Knopf durchwechselt.
enum ViewMode { standard, headingUp, dark }

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

  // Routen (Haupt- + Alternativen)
  List<RouteResult> _alts = [];
  int _sel = 0;
  List<double> _cum = [0];
  int _nextMan = 0;
  final Set<int> _spoken = {};
  final Set<int> _camSpoken = {};
  List<Camera> _cameras = [];
  Camera? _nearCam;
  double _camDist = 0;

  bool _navigating = false, _follow = true;
  List<Map<String, dynamic>> _suggest = [];
  Timer? _suggestTimer;

  // Einstellungen
  String _lang = 'de';         // de | en | ar
  bool _voice = true;
  bool _showLanes = true;
  bool _showCams = true;
  bool _miles = false;
  ViewMode _view = ViewMode.standard;

  RouteResult? get _route => (_alts.isNotEmpty && _sel < _alts.length) ? _alts[_sel] : null;

  @override
  void initState() {
    super.initState();
    _applyTtsLang();
    _tts.setSpeechRate(0.95);
    _initLocation();
  }

  @override
  void dispose() {
    _posSub?.cancel();
    _search.dispose();
    _suggestTimer?.cancel();
    super.dispose();
  }

  // ---------- Sprache ----------
  void _applyTtsLang() {
    _tts.setLanguage(_lang == 'ar' ? 'ar-SA' : (_lang == 'en' ? 'en-US' : 'de-DE'));
  }

  String _t(String key) => (_strings[_lang] ?? _strings['de']!)[key] ?? key;
  String _man(String mkey) =>
      (_maneuverText[_lang] ?? _maneuverText['de']!)[mkey] ?? '';

  bool get _rtl => _lang == 'ar';

  void _speak(String s) {
    if (_voice) _tts.speak(s);
  }

  // ---------- Standort ----------
  Future<void> _initLocation() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        setState(() => _status = _t('enableLocation'));
        return;
      }
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        setState(() => _status = _t('needPermission'));
        return;
      }
      final p = await Geolocator.getCurrentPosition();
      _applyPosition(p, center: true);
      _posSub = Geolocator.getPositionStream(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 4),
      ).listen(_applyPosition);
    } catch (e) {
      setState(() => _status = 'GPS: $e');
    }
  }

  void _applyPosition(Position p, {bool center = false}) {
    final ll = LatLng(p.latitude, p.longitude);
    setState(() {
      _pos = ll;
      _speedKmh = (p.speed.isFinite && p.speed > 0) ? p.speed * 3.6 : 0;
      if (p.heading.isFinite && p.heading >= 0) _heading = p.heading;
      _status = '';
    });
    if (center) _map.move(ll, 16);
    if (_navigating) {
      if (_follow) _recenterCamera(ll);
      _updateGuidance(ll);
    }
  }

  void _recenterCamera(LatLng ll) {
    if (_view == ViewMode.headingUp) {
      _map.moveAndRotate(ll, _map.camera.zoom, -_heading);
    } else {
      _map.move(ll, _map.camera.zoom);
    }
  }

  // ---------- Route ----------
  Future<void> _computeRoute(LatLng to) async {
    if (_pos == null) return;
    setState(() => _status = _t('calcRoute'));
    final list = await NavService.routes(_pos!, to);
    if (list.isEmpty) {
      setState(() => _status = _t('noRoute'));
      return;
    }
    setState(() {
      _alts = list;
      _sel = 0;
      _nextMan = 0;
      _spoken.clear();
      _camSpoken.clear();
      _cameras = [];
      _status = '';
    });
    _rebuildCum();
    _fitRoute(_route!.points);
    // Blitzer nachladen (nicht blockierend).
    if (_showCams) {
      NavService.cameras(_route!.points).then((c) {
        if (mounted) setState(() => _cameras = c);
      });
    }
  }

  void _rebuildCum() {
    final r = _route;
    if (r == null) return;
    _cum = [0];
    for (var i = 0; i < r.points.length - 1; i++) {
      _cum.add(_cum[i] + _distance.as(LengthUnit.Meter, r.points[i], r.points[i + 1]));
    }
  }

  void _selectAlt(int i) {
    setState(() {
      _sel = i;
      _nextMan = 0;
      _spoken.clear();
      _camSpoken.clear();
    });
    _rebuildCum();
    if (_showCams) {
      NavService.cameras(_route!.points).then((c) {
        if (mounted) setState(() => _cameras = c);
      });
    }
  }

  void _fitRoute(List<LatLng> pts) {
    if (pts.isEmpty) return;
    _map.fitCamera(CameraFit.bounds(
      bounds: LatLngBounds.fromPoints(pts),
      padding: const EdgeInsets.fromLTRB(40, 140, 40, 240),
    ));
  }

  int _nearestIndex(LatLng ll) {
    final r = _route;
    if (r == null) return 0;
    var best = 0;
    var bd = double.infinity;
    for (var i = 0; i < r.points.length; i++) {
      final d = _distance.as(LengthUnit.Meter, ll, r.points[i]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  double _remainingMeters(LatLng ll) {
    final r = _route;
    if (r == null) return 0;
    final i = _nearestIndex(ll);
    return (r.distance - _cum[i]).clamp(0, r.distance);
  }

  void _updateGuidance(LatLng ll) {
    final r = _route;
    if (r == null) return;
    if (r.maneuvers.isNotEmpty) {
      while (_nextMan < r.maneuvers.length - 1 &&
          _distance.as(LengthUnit.Meter, ll, r.maneuvers[_nextMan].location) < 25) {
        _nextMan++;
      }
      final man = r.maneuvers[_nextMan];
      final d = _distance.as(LengthUnit.Meter, ll, man.location);
      final instr = _man(man.key);
      if (d < 60 && !_spoken.contains(_nextMan * 10 + 3)) {
        _spoken.add(_nextMan * 10 + 3);
        _speak('${_t('now')} $instr');
      } else if (d < 250 && !_spoken.contains(_nextMan * 10 + 2)) {
        _spoken.add(_nextMan * 10 + 2);
        _speak(_inPhrase(d, instr));
      } else if (d < 700 && !_spoken.contains(_nextMan * 10 + 1)) {
        _spoken.add(_nextMan * 10 + 1);
        _speak(_inPhrase(d, instr));
      }
    }
    _updateCameraWarning(ll);
    setState(() {});
    if (_remainingMeters(ll) < 25) _arrive();
  }

  String _inPhrase(double d, String instr) {
    final unit = _miles ? _t('yards') : _t('meters');
    final val = _miles ? (_round(d) * 1.09361).round() : _round(d);
    return '${_t('in')} $val $unit $instr';
  }

  void _updateCameraWarning(LatLng ll) {
    _nearCam = null;
    _camDist = 0;
    if (!_showCams || _cameras.isEmpty) return;
    final idxHere = _cum[_nearestIndex(ll)];
    Camera? best;
    var bestD = 400.0;
    for (var i = 0; i < _cameras.length; i++) {
      final c = _cameras[i];
      // nur Blitzer, die noch vor uns liegen
      final ci = _cum[_nearestIndex(c.location)];
      if (ci < idxHere - 20) continue;
      final d = _distance.as(LengthUnit.Meter, ll, c.location);
      if (d < bestD) {
        bestD = d;
        best = c;
        if (d < 300 && !_camSpoken.contains(i)) {
          _camSpoken.add(i);
          _speak(_t('camera'));
        }
      }
    }
    _nearCam = best;
    _camDist = bestD;
  }

  int _round(double m) => (m / 10).round() * 10;

  void _arrive() {
    setState(() => _navigating = false);
    _map.rotate(0);
    _speak(_man('arrive'));
  }

  void _startStop() {
    if (_route == null) return;
    setState(() {
      _navigating = !_navigating;
      _follow = true;
    });
    if (_navigating) {
      _speak(_t('started'));
      if (_pos != null) {
        _map.move(_pos!, 17);
        _updateGuidance(_pos!);
      }
    } else {
      _map.rotate(0);
    }
  }

  Future<void> _doSearch() async {
    final q = _search.text.trim();
    if (q.isEmpty) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _suggest = [];
      _status = _t('searching');
    });
    final to = await NavService.geocode(q);
    if (to == null) {
      setState(() => _status = _t('notFound'));
      return;
    }
    await _computeRoute(to);
  }

  void _onSearchChanged(String v) {
    _suggestTimer?.cancel();
    _suggestTimer = Timer(const Duration(milliseconds: 400), () async {
      final s = await NavService.suggest(v);
      if (mounted) setState(() => _suggest = s);
    });
  }

  void _cycleView() {
    setState(() {
      _view = ViewMode.values[(_view.index + 1) % ViewMode.values.length];
    });
    if (_view != ViewMode.headingUp) _map.rotate(0);
    if (_view == ViewMode.headingUp && _navigating && _pos != null) {
      _map.moveAndRotate(_pos!, _map.camera.zoom, -_heading);
    }
  }

  void _zoom(double d) =>
      _map.move(_map.camera.center, (_map.camera.zoom + d).clamp(3.0, 19.0));

  void _recenter() {
    if (_pos == null) return;
    setState(() => _follow = true);
    _recenterCamera(_pos!);
    if (!_navigating) _map.move(_pos!, 16);
  }

  // ---------- UI ----------
  @override
  Widget build(BuildContext context) {
    final center = _pos ?? const LatLng(24.7136, 46.6753); // Riad als Fallback
    final dark = _view == ViewMode.dark;
    return Directionality(
      textDirection: _rtl ? TextDirection.rtl : TextDirection.ltr,
      child: Scaffold(
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
                urlTemplate: dark
                    ? 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
                    : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.masar.app',
              ),
              // Alternativen grau, gewählte Route grün.
              PolylineLayer(polylines: _routeLines()),
              if (_showCams)
                MarkerLayer(markers: [
                  for (final c in _cameras)
                    Marker(
                      point: c.location,
                      width: 26,
                      height: 26,
                      rotate: true,
                      child: _camMarker(),
                    ),
                ]),
              if (_pos != null)
                MarkerLayer(markers: [
                  Marker(
                    point: _pos!,
                    width: 30,
                    height: 30,
                    child: Transform.rotate(
                      angle: _heading * math.pi / 180,
                      child: _puck(),
                    ),
                  ),
                ]),
            ],
          ),

          // Oben: Suche + Menü  /  Anweisung + Spuren
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: _navigating ? _navTop() : _searchBar(),
            ),
          ),

          if (_status.isNotEmpty) _statusPill(),

          // Alternativrouten-Leiste (vor Start)
          if (!_navigating && _alts.length > 1) _altBar(),

          // Rechts: Ansicht, Zoom, Zentrieren
          SafeArea(
            child: Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(right: 10, bottom: 96),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  _roundBtn(_viewIcon(), _cycleView, tint: _go),
                  const SizedBox(height: 8),
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

          // Blitzer-Warnschild (während Navigation)
          if (_navigating && _nearCam != null) _camWarnBadge(),

          // Unten: Tacho + ETA + Start/Stop
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
      ),
    );
  }

  List<Polyline> _routeLines() {
    final lines = <Polyline>[];
    for (var i = 0; i < _alts.length; i++) {
      if (i == _sel) continue;
      lines.add(Polyline(points: _alts[i].points, strokeWidth: 6, color: _grey));
    }
    final r = _route;
    if (r != null) {
      lines.add(Polyline(points: r.points, strokeWidth: 10, color: const Color(0xAA0C8F63)));
      lines.add(Polyline(points: r.points, strokeWidth: 6, color: _go));
    }
    return lines;
  }

  Widget _puck() => Stack(alignment: Alignment.center, children: [
        Container(
          decoration: BoxDecoration(
            color: const Color(0xFF2B83FF),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 3),
            boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 6)],
          ),
        ),
        const Positioned(top: 0, child: Icon(Icons.navigation, color: Colors.white, size: 13)),
      ]);

  Widget _camMarker() => Container(
        decoration: BoxDecoration(
          color: _warn,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 2),
        ),
        child: const Icon(Icons.camera_alt, color: Colors.white, size: 14),
      );

  IconData _viewIcon() {
    switch (_view) {
      case ViewMode.headingUp:
        return Icons.navigation;
      case ViewMode.dark:
        return Icons.dark_mode;
      case ViewMode.standard:
        return Icons.layers;
    }
  }

  // Suche + Menübutton
  Widget _searchBar() {
    return Column(children: [
      Row(children: [
        Expanded(
          child: Material(
            color: _panel,
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(children: [
                const Icon(Icons.search, color: Colors.white70),
                Expanded(
                  child: TextField(
                    controller: _search,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      hintText: _t('where'),
                      hintStyle: const TextStyle(color: Colors.white38),
                      border: InputBorder.none,
                    ),
                    textInputAction: TextInputAction.search,
                    onChanged: _onSearchChanged,
                    onSubmitted: (_) => _doSearch(),
                  ),
                ),
                if (_route != null)
                  TextButton(
                    onPressed: _startStop,
                    child: Text(_t('start'),
                        style: const TextStyle(color: _go, fontWeight: FontWeight.bold)),
                  ),
              ]),
            ),
          ),
        ),
        const SizedBox(width: 8),
        _roundBtn(Icons.tune, _openMenu),
      ]),
      for (final s in _suggest)
        Material(
          color: const Color(0xFF0A1428),
          child: ListTile(
            dense: true,
            title: Text(s['display_name'] as String,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white, fontSize: 13)),
            onTap: () {
              _search.text = (s['display_name'] as String).split(',').first;
              setState(() => _suggest = []);
              _computeRoute(
                  LatLng(double.parse(s['lat'] as String), double.parse(s['lon'] as String)));
            },
          ),
        ),
    ]);
  }

  // Anweisung + Fahrspuren (während Navigation)
  Widget _navTop() {
    final r = _route!;
    final man = (r.maneuvers.isNotEmpty && _nextMan < r.maneuvers.length)
        ? r.maneuvers[_nextMan]
        : null;
    final d = (man != null && _pos != null)
        ? _distance.as(LengthUnit.Meter, _pos!, man.location)
        : 0.0;
    return Column(children: [
      Material(
        color: _panel,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            Icon(_iconFor(man?.key ?? 'straight'), color: _go, size: 40),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('${_round(d)} m',
                      style: const TextStyle(
                          color: Colors.white, fontSize: 30, fontWeight: FontWeight.w800)),
                  Text(
                      man == null || man.name.isEmpty
                          ? _man(man?.key ?? 'straight')
                          : '${_man(man.key)} · ${man.name}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: Colors.white70, fontSize: 14, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
            IconButton(
                onPressed: _openMenu, icon: const Icon(Icons.tune, color: Colors.white54)),
          ]),
        ),
      ),
      if (_showLanes && man != null && man.lanes.isNotEmpty && d < 600) _lanePanel(man),
    ]);
  }

  Widget _lanePanel(Maneuver man) {
    return Container(
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
      decoration: BoxDecoration(
        color: _panel,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          for (final ln in man.lanes)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3),
              child: Container(
                width: 34,
                height: 40,
                decoration: BoxDecoration(
                  color: ln.valid ? _go.withValues(alpha: 0.18) : Colors.transparent,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: ln.valid ? _go : Colors.white24, width: ln.valid ? 2 : 1),
                ),
                child: Icon(_iconFor(ln.arrow),
                    color: ln.valid ? _go : Colors.white38, size: 22),
              ),
            ),
        ],
      ),
    );
  }

  IconData _iconFor(String key) {
    switch (key) {
      case 'right':
        return Icons.turn_right;
      case 'left':
        return Icons.turn_left;
      case 'slightRight':
        return Icons.turn_slight_right;
      case 'slightLeft':
        return Icons.turn_slight_left;
      case 'uturn':
        return Icons.u_turn_left;
      case 'arrive':
        return Icons.flag;
      default:
        return Icons.straight;
    }
  }

  Widget _altBar() {
    return Positioned(
      left: 10,
      right: 64,
      bottom: 96,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (var i = 0; i < _alts.length; i++)
            GestureDetector(
              onTap: () => _selectAlt(i),
              child: Container(
                margin: const EdgeInsets.only(right: 8),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: _panel,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: i == _sel ? _go : Colors.white24, width: 2),
                ),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text('${(_alts[i].duration / 60).round()} ${_t('min')}',
                      style: TextStyle(
                          color: i == _sel ? _go : Colors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: 16)),
                  Text(_fmtKm(_alts[i].distance),
                      style: const TextStyle(color: Colors.white54, fontSize: 12)),
                ]),
              ),
            ),
        ]),
      ),
    );
  }

  Widget _camWarnBadge() {
    return Positioned(
      left: 12,
      bottom: 100,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: _warn,
          borderRadius: BorderRadius.circular(12),
          boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 8)],
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.camera_alt, color: Colors.white, size: 20),
          const SizedBox(width: 8),
          Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(_t('camera'),
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13)),
            Text('${_round(_camDist)} m${_nearCam?.maxspeed != null ? ' · ${_nearCam!.maxspeed} km/h' : ''}',
                style: const TextStyle(color: Colors.white70, fontSize: 11)),
          ]),
        ]),
      ),
    );
  }

  Widget _bottomBar() {
    final rem = _pos != null ? _remainingMeters(_pos!) : 0.0;
    final min = (rem / 1000 / 50 * 60).clamp(0, 999).round();
    final over = _speedKmh > 121; // grobe Tempo-Warnung
    return Row(children: [
      Container(
        width: 72,
        height: 72,
        decoration: BoxDecoration(
          color: _panel,
          shape: BoxShape.circle,
          border: Border.all(color: over ? _warn : _go, width: 3),
        ),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text('${_speedKmh.round()}',
              style: TextStyle(
                  color: over ? _warn : Colors.white,
                  fontSize: 26,
                  fontWeight: FontWeight.w800)),
          Text(_miles ? 'mph' : 'km/h', style: const TextStyle(color: Colors.white54, fontSize: 9)),
        ]),
      ),
      const Spacer(),
      if (_route != null)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(color: _panel, borderRadius: BorderRadius.circular(14)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_navigating ? '$min ${_t('min')}' : _fmtKm(_route!.distance),
                  style: const TextStyle(
                      color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
              Text(_fmtKm(rem), style: const TextStyle(color: Colors.white54, fontSize: 12)),
            ],
          ),
        ),
      const Spacer(),
      FloatingActionButton(
        backgroundColor: _navigating ? _warn : _go,
        onPressed: _route == null ? null : _startStop,
        child: Icon(_navigating ? Icons.close : Icons.navigation, color: Colors.black),
      ),
    ]);
  }

  String _fmtKm(double m) {
    if (_miles) return '${(m / 1609.34).toStringAsFixed(1)} mi';
    return '${(m / 1000).toStringAsFixed(1)} km';
  }

  Widget _statusPill() => Align(
        alignment: Alignment.center,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(color: _panel, borderRadius: BorderRadius.circular(12)),
          child: Text(_status, style: const TextStyle(color: Colors.white, fontSize: 13)),
        ),
      );

  Widget _roundBtn(IconData icon, VoidCallback onTap, {Color tint = Colors.white}) => Material(
        color: _panel,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: Padding(padding: const EdgeInsets.all(11), child: Icon(icon, color: tint, size: 22)),
        ),
      );

  // ---------- Menü ----------
  void _openMenu() {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF0C1426),
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => StatefulBuilder(
        builder: (ctx, setSheet) {
          void set(VoidCallback fn) {
            setSheet(fn);
            setState(fn);
          }

          return Directionality(
            textDirection: _rtl ? TextDirection.rtl : TextDirection.ltr,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 18, 28),
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: 14),
                    decoration: BoxDecoration(
                        color: Colors.white24, borderRadius: BorderRadius.circular(2)),
                  ),
                ),
                Text(_t('settings'),
                    style: const TextStyle(
                        color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800)),
                const SizedBox(height: 14),
                Text(_t('language'), style: const TextStyle(color: Colors.white54, fontSize: 13)),
                const SizedBox(height: 6),
                Row(children: [
                  _langChip('de', 'Deutsch', set),
                  _langChip('en', 'English', set),
                  _langChip('ar', 'العربية', set),
                ]),
                const SizedBox(height: 6),
                _toggle(_t('voice'), _voice, (v) => set(() => _voice = v)),
                _toggle(_t('lanes'), _showLanes, (v) => set(() => _showLanes = v)),
                _toggle(_t('cams'), _showCams, (v) => set(() => _showCams = v)),
                _toggle(_t('miles'), _miles, (v) => set(() => _miles = v)),
              ]),
            ),
          );
        },
      ),
    );
  }

  Widget _langChip(String code, String label, void Function(VoidCallback) set) {
    final active = _lang == code;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: GestureDetector(
        onTap: () => set(() {
          _lang = code;
          _applyTtsLang();
        }),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
          decoration: BoxDecoration(
            color: active ? _go.withValues(alpha: 0.16) : Colors.white10,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: active ? _go : Colors.white24),
          ),
          child: Text(label,
              style: TextStyle(
                  color: active ? _go : Colors.white,
                  fontWeight: active ? FontWeight.w700 : FontWeight.w500)),
        ),
      ),
    );
  }

  Widget _toggle(String label, bool value, ValueChanged<bool> onChanged) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(children: [
        Expanded(child: Text(label, style: const TextStyle(color: Colors.white, fontSize: 15))),
        Switch(value: value, activeThumbColor: _go, onChanged: onChanged),
      ]),
    );
  }

  // ---------- Texte ----------
  static const _strings = {
    'de': {
      'where': 'Wohin? (Adresse oder Ort)',
      'start': 'Start',
      'settings': 'Einstellungen',
      'language': 'Sprache',
      'voice': 'Sprachansagen',
      'lanes': 'Fahrspur-Assistent',
      'cams': 'Blitzer anzeigen',
      'miles': 'Meilen statt Kilometer',
      'in': 'In',
      'now': 'Jetzt',
      'meters': 'Metern',
      'yards': 'Yards',
      'min': 'Min',
      'camera': 'Blitzer',
      'calcRoute': 'Route wird berechnet …',
      'noRoute': 'Keine Route gefunden',
      'searching': 'Suche …',
      'notFound': 'Ort nicht gefunden',
      'started': 'Route gestartet',
      'enableLocation': 'Bitte Standortdienste aktivieren',
      'needPermission': 'Standort-Berechtigung nötig',
    },
    'en': {
      'where': 'Where to? (address or place)',
      'start': 'Start',
      'settings': 'Settings',
      'language': 'Language',
      'voice': 'Voice guidance',
      'lanes': 'Lane assist',
      'cams': 'Show speed cameras',
      'miles': 'Miles instead of km',
      'in': 'In',
      'now': 'Now',
      'meters': 'meters',
      'yards': 'yards',
      'min': 'min',
      'camera': 'Speed camera',
      'calcRoute': 'Calculating route …',
      'noRoute': 'No route found',
      'searching': 'Searching …',
      'notFound': 'Place not found',
      'started': 'Route started',
      'enableLocation': 'Please enable location services',
      'needPermission': 'Location permission needed',
    },
    'ar': {
      'where': 'إلى أين؟ (عنوان أو مكان)',
      'start': 'ابدأ',
      'settings': 'الإعدادات',
      'language': 'اللغة',
      'voice': 'التوجيه الصوتي',
      'lanes': 'مساعد المسار',
      'cams': 'إظهار كاميرات ساهر',
      'miles': 'أميال بدل الكيلومترات',
      'in': 'بعد',
      'now': 'الآن',
      'meters': 'متر',
      'yards': 'ياردة',
      'min': 'دقيقة',
      'camera': 'كاميرا ساهر',
      'calcRoute': 'يتم حساب المسار …',
      'noRoute': 'لم يتم العثور على مسار',
      'searching': 'جارٍ البحث …',
      'notFound': 'المكان غير موجود',
      'started': 'بدأ المسار',
      'enableLocation': 'يرجى تفعيل خدمات الموقع',
      'needPermission': 'مطلوب إذن الموقع',
    },
  };

  static const _maneuverText = {
    'de': {
      'right': 'rechts abbiegen',
      'left': 'links abbiegen',
      'slightRight': 'leicht rechts halten',
      'slightLeft': 'leicht links halten',
      'uturn': 'wenden',
      'straight': 'geradeaus',
      'depart': 'losfahren',
      'arrive': 'Ziel erreicht',
    },
    'en': {
      'right': 'turn right',
      'left': 'turn left',
      'slightRight': 'keep slightly right',
      'slightLeft': 'keep slightly left',
      'uturn': 'make a U-turn',
      'straight': 'go straight',
      'depart': 'start',
      'arrive': 'you have arrived',
    },
    'ar': {
      'right': 'انعطف يمينًا',
      'left': 'انعطف يسارًا',
      'slightRight': 'خذ يمينك قليلًا',
      'slightLeft': 'خذ يسارك قليلًا',
      'uturn': 'اعكس الاتجاه',
      'straight': 'استمر مستقيمًا',
      'depart': 'انطلق',
      'arrive': 'لقد وصلت',
    },
  };
}
