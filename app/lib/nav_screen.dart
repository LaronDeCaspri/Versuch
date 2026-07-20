import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'services.dart';

const _go = Color(0xFF25E39A);
const _warn = Color(0xFFFF4D5E);
const _panel = Color(0xF20C1426);
const _grey = Color(0x998890A8);
const _panelLight = Color(0xFF15213C);

/// Kartenansichten, die der Umschalt-Knopf durchwechselt.
enum ViewMode { standard, headingUp, dark }

class NavScreen extends StatefulWidget {
  const NavScreen({super.key});
  @override
  State<NavScreen> createState() => _NavScreenState();
}

class _NavScreenState extends State<NavScreen> with TickerProviderStateMixin {
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
  Timer? _rerouteTimer;
  bool _offRoute = false;
  bool _rerouteInProgress = false;

  bool _navigating = false, _follow = true;
  List<Map<String, dynamic>> _suggest = [];
  Timer? _suggestTimer;

  // Einstellungen + Persistenz
  String _lang = 'de';         // de | en | ar
  bool _voice = true;
  bool _showLanes = true;
  bool _showCams = true;
  bool _miles = false;
  ViewMode _view = ViewMode.standard;
  late SharedPreferences _prefs;
  LatLng? _home;
  LatLng? _work;
  List<String> _recentSearches = [];

  late AnimationController _speedLimitAnimController;
  late Animation<double> _speedLimitAnim;
  late AnimationController _turnPreviewAnimController;
  late Animation<double> _turnPreviewAnim;

  // Advanced features
  List<Hazard> _hazards = [];
  bool _showTurnPreview = true;
  bool _showSpeedProfile = false;
  int _routePreference = 0; // 0=fastest, 1=shortest, 2=scenic
  Timer? _etaUpdateTimer;
  DateTime? _navigationStartTime;
  double _distanceTraveled = 0;

  RouteResult? get _route => (_alts.isNotEmpty && _sel < _alts.length) ? _alts[_sel] : null;
  bool get _isDarkTheme => _view == ViewMode.dark || _shouldAutoNightMode();

  @override
  void initState() {
    super.initState();
    _applyTtsLang();
    _tts.setSpeechRate(0.95);
    _initPrefs();
    _speedLimitAnimController = AnimationController(duration: const Duration(milliseconds: 600), vsync: this);
    _speedLimitAnim = Tween<double>(begin: 1.0, end: 1.0).animate(_speedLimitAnimController);
    _turnPreviewAnimController = AnimationController(duration: const Duration(milliseconds: 800), vsync: this);
    _turnPreviewAnim = Tween<double>(begin: 0.0, end: 1.0).animate(CurvedAnimation(parent: _turnPreviewAnimController, curve: Curves.easeOutQuart));
    _initLocation();
    _loadSimulatedHazards();
  }

  Future<void> _initPrefs() async {
    _prefs = await SharedPreferences.getInstance();
    setState(() {
      final homeLat = _prefs.getDouble('home_lat');
      final homeLon = _prefs.getDouble('home_lon');
      if (homeLat != null && homeLon != null) _home = LatLng(homeLat, homeLon);
      final workLat = _prefs.getDouble('work_lat');
      final workLon = _prefs.getDouble('work_lon');
      if (workLat != null && workLon != null) _work = LatLng(workLat, workLon);
      _recentSearches = _prefs.getStringList('recent_searches') ?? [];
      _lang = _prefs.getString('language') ?? 'de';
      _voice = _prefs.getBool('voice') ?? true;
      _showLanes = _prefs.getBool('show_lanes') ?? true;
      _showCams = _prefs.getBool('show_cams') ?? true;
      _miles = _prefs.getBool('miles') ?? false;
    });
    _applyTtsLang();
  }

  @override
  void dispose() {
    _posSub?.cancel();
    _search.dispose();
    _suggestTimer?.cancel();
    _rerouteTimer?.cancel();
    _etaUpdateTimer?.cancel();
    _speedLimitAnimController.dispose();
    _turnPreviewAnimController.dispose();
    super.dispose();
  }

  // ---------- Sprache und Theme ----------
  bool _shouldAutoNightMode() {
    final now = DateTime.now();
    // Zwischen 21:00 und 06:00 automatisch dunkel
    return now.hour >= 21 || now.hour < 6;
  }

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

  void _savePref(String key, dynamic value) {
    if (value is String) {
      _prefs.setString(key, value);
    } else if (value is bool) {
      _prefs.setBool(key, value);
    } else if (value is double) {
      _prefs.setDouble(key, value);
    } else if (value is int) {
      _prefs.setInt(key, value);
    } else if (value is List<String>) {
      _prefs.setStringList(key, value);
    }
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
      _checkOffRoute(ll);
    }
  }

  void _checkOffRoute(LatLng ll) {
    final r = _route;
    if (r == null) return;
    final idx = _nearestIndex(ll);
    final distToRoute = _distance.as(LengthUnit.Meter, ll, r.points[idx]);
    final wasOffRoute = _offRoute;
    _offRoute = distToRoute > 50; // Wenn >50m entfernt, als "off-route" markieren

    if (_offRoute && !wasOffRoute) {
      _speak(_t('offRoute'));
      _triggerReroute(ll);
    }
    if (_offRoute != wasOffRoute) setState(() {});
  }

  void _triggerReroute(LatLng from) {
    if (_rerouteInProgress) return;
    _rerouteTimer?.cancel();
    _rerouteTimer = Timer(const Duration(seconds: 2), () async {
      if (!_navigating) return;
      setState(() => _rerouteInProgress = true);
      final list = await NavService.routes(from, _route!.points.last);
      if (list.isNotEmpty && mounted) {
        setState(() {
          _alts = list;
          _sel = 0;
          _nextMan = 0;
          _spoken.clear();
          _offRoute = false;
          _rerouteInProgress = false;
        });
        _rebuildCum();
        if (_showCams) {
          NavService.cameras(_route!.points).then((c) {
            if (mounted) setState(() => _cameras = c);
          });
        }
      }
    });
  }

  void _recenterCamera(LatLng ll) {
    // Speed-dependent zoom: schneller fahren = weiter rauszoomen
    double targetZoom = 17;
    if (_speedKmh > 100) targetZoom = 15.5;
    else if (_speedKmh > 70) targetZoom = 16;
    else if (_speedKmh > 40) targetZoom = 16.5;

    if (_view == ViewMode.headingUp) {
      _map.moveAndRotate(ll, targetZoom, -_heading);
    } else {
      _map.move(ll, targetZoom);
    }
  }

  // ---------- Route ----------
  Future<void> _computeRoute(LatLng to, {String? query}) async {
    if (_pos == null) return;
    setState(() => _status = _t('calcRoute'));
    final list = await NavService.routes(_pos!, to);
    if (list.isEmpty) {
      setState(() => _status = _t('noRoute'));
      return;
    }
    // Speichere Suche als recent (wenn query vorhanden)
    if (query != null && query.isNotEmpty) {
      if (_recentSearches.contains(query)) _recentSearches.remove(query);
      _recentSearches.insert(0, query);
      if (_recentSearches.length > 10) _recentSearches.removeLast();
      _savePref('recent_searches', _recentSearches);
    }
    setState(() {
      _alts = list;
      _sel = 0;
      _nextMan = 0;
      _spoken.clear();
      _camSpoken.clear();
      _cameras = [];
      _status = '';
      _offRoute = false;
    });
    _rebuildCum();
    _fitRoute(_route!.points);
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

  double _routeProgress(LatLng ll) {
    final r = _route;
    if (r == null || r.distance == 0) return 0;
    final i = _nearestIndex(ll);
    return (_cum[i] / r.distance).clamp(0, 1);
  }

  int? _currentSpeedLimit() {
    final r = _route;
    if (r == null || r.limits.isEmpty || _pos == null) return null;
    final i = _nearestIndex(_pos!);
    if (i < r.limits.length) return r.limits[i];
    return null;
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
      final nextStreet = man.name.isNotEmpty ? man.name : '';

      // Multiple guidance callouts at different distances
      if (d < 30 && !_spoken.contains(_nextMan * 10 + 4)) {
        _spoken.add(_nextMan * 10 + 4);
        final nextInstr = _nextMan + 1 < r.maneuvers.length
            ? _man(r.maneuvers[_nextMan + 1].key)
            : _t('destination');
        _speak('${_t('now')} $instr${nextStreet.isNotEmpty ? ' onto ${nextStreet}' : ''}. ${_t('then')} $nextInstr');
      } else if (d < 100 && !_spoken.contains(_nextMan * 10 + 3)) {
        _spoken.add(_nextMan * 10 + 3);
        _speak('${_round(d)}${_miles ? ' yards' : ' meters'} $instr');
      } else if (d < 300 && !_spoken.contains(_nextMan * 10 + 2)) {
        _spoken.add(_nextMan * 10 + 2);
        _speak(_inPhrase(d, instr));
      } else if (d < 800 && !_spoken.contains(_nextMan * 10 + 1)) {
        _spoken.add(_nextMan * 10 + 1);
        _speak(_inPhrase(d, instr));
      } else if (d < 1500 && !_spoken.contains(_nextMan * 10)) {
        _spoken.add(_nextMan * 10);
        _speak('${_t('prepareFor')} $instr');
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
    _etaUpdateTimer?.cancel();
  }

  void _loadSimulatedHazards() {
    // Simulate some hazards - in real app this would come from Waze-like crowdsourcing
    _hazards = [
      Hazard(const LatLng(24.7455, 46.6881), 'slowTraffic', 'Heavy traffic ahead', DateTime.now()),
      Hazard(const LatLng(24.7200, 46.6700), 'construction', 'Road work on King Fahd Rd', DateTime.now()),
    ];
  }

  List<Maneuver> _getUpcomingManeuvers(int count) {
    final r = _route;
    if (r == null) return [];
    final start = _nextMan;
    final end = (start + count).clamp(0, r.maneuvers.length);
    return r.maneuvers.sublist(start, end);
  }

  double _distanceToManeuver(int maneuverIndex) {
    final r = _route;
    if (r == null || _pos == null || maneuverIndex >= r.maneuvers.length) return 0;
    return _distance.as(LengthUnit.Meter, _pos!, r.maneuvers[maneuverIndex].location);
  }

  String _nextStreetName() {
    final r = _route;
    if (r == null || _nextMan + 1 >= r.maneuvers.length) return '';
    final nextMan = r.maneuvers[_nextMan + 1];
    return nextMan.name.isNotEmpty ? nextMan.name : _man(nextMan.key);
  }

  void _startNavigation() {
    _navigationStartTime = DateTime.now();
    _distanceTraveled = 0;
    _etaUpdateTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (_navigating && _pos != null) {
        setState(() {});
      }
    });
  }

  void _startStop() {
    if (_route == null) return;
    setState(() {
      _navigating = !_navigating;
      _follow = true;
    });
    if (_navigating) {
      _speak(_t('started'));
      _startNavigation();
      if (_pos != null) {
        _map.move(_pos!, 17);
        _updateGuidance(_pos!);
      }
    } else {
      _map.rotate(0);
      _etaUpdateTimer?.cancel();
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
    await _computeRoute(to, query: q);
  }

  Future<void> _routeToLocation(LatLng to, {String? label}) async {
    FocusScope.of(context).unfocus();
    setState(() {
      _search.text = label ?? 'Ziel';
      _suggest = [];
    });
    await _computeRoute(to, query: label);
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
    final dark = _isDarkTheme;
    return Directionality(
      textDirection: _rtl ? TextDirection.rtl : TextDirection.ltr,
      child: Scaffold(
        backgroundColor: dark ? const Color(0xFF0A0F1A) : const Color(0xFF0A1122),
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
              PolylineLayer(polylines: _routeLines()),

              // Hazard markers
              MarkerLayer(markers: [
                for (final h in _hazards.where((h) {
                  if (_pos == null) return false;
                  return _distance.as(LengthUnit.Meter, _pos!, h.location) < 3000;
                }))
                  Marker(
                    point: h.location,
                    width: 32,
                    height: 32,
                    child: _hazardMarker(h),
                  ),
              ]),

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

          // Top: Search / Navigation Info
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: _navigating ? _navTop() : _searchBar(),
            ),
          ),

          if (_status.isNotEmpty) _statusPill(),

          // Alt routes before start
          if (!_navigating && _alts.length > 1) _altBar(),

          // Right side: View, Zoom, Recenter
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

          // Speed limit sign + camera warning + hazards (during navigation)
          if (_navigating) ...[
            if (_currentSpeedLimit() != null) _speedLimitSign(),
            if (_nearCam != null) _camWarnBadge(),
            ..._hazardWarnings(),
          ],

          // Turn-by-turn preview (during navigation)
          if (_navigating && _showTurnPreview) _turnPreviewPanel(),

          // Speed profile chart (optional, can be toggled)
          if (_navigating && _showSpeedProfile) _speedProfileChart(),

          // Navigation top bar with detailed info
          if (_navigating)
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: SafeArea(
                child: _navInfoBar(),
              ),
            ),

          // Bottom: Speedometer + ETA + Start/Stop
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
          boxShadow: const [BoxShadow(color: Color(0x80FF4D5E), blurRadius: 8)],
        ),
        child: const Icon(Icons.camera_alt, color: Colors.white, size: 14),
      );

  Widget _hazardMarker(Hazard h) => Container(
        decoration: BoxDecoration(
          color: h.type == 'accident'
              ? Colors.red
              : h.type == 'construction'
                  ? Colors.orange
                  : h.type == 'slowTraffic'
                      ? Colors.amber
                      : Colors.orange,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 2),
          boxShadow: [
            BoxShadow(
              color: h.type == 'accident'
                  ? Colors.red.withValues(alpha: 0.5)
                  : Colors.orange.withValues(alpha: 0.3),
              blurRadius: 8,
            ),
          ],
        ),
        child: Icon(
          h.type == 'accident'
              ? Icons.warning
              : h.type == 'construction'
                  ? Icons.construction
                  : h.type == 'slowTraffic'
                      ? Icons.traffic
                      : Icons.warning_amber,
          color: Colors.white,
          size: 16,
        ),
      );

  Widget _speedLimitSign() {
    final limit = _currentSpeedLimit();
    if (limit == null) return const SizedBox.shrink();
    final warning = _speedKmh > limit;
    return Positioned(
      top: 100,
      right: 12,
      child: ScaleTransition(
        scale: _speedLimitAnim,
        child: Container(
          width: 60,
          height: 60,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 3),
            color: warning ? _warn : Colors.white,
            boxShadow: [
              BoxShadow(
                color: warning ? _warn.withValues(alpha: 0.4) : Colors.black26,
                blurRadius: 12,
              ),
            ],
          ),
          child: Center(
            child: Text(
              '$limit',
              style: TextStyle(
                color: warning ? Colors.white : Colors.black,
                fontSize: 22,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _hazardWarnings() {
    final warnings = <Widget>[];
    for (final h in _hazards.where((h) {
      if (_pos == null) return false;
      final d = _distance.as(LengthUnit.Meter, _pos!, h.location);
      return d < 2000; // Show hazards within 2km
    })) {
      final d = _distance.as(LengthUnit.Meter, _pos!, h.location);
      if (d < 500) { // Show badge for hazards < 500m
        warnings.add(
          Positioned(
            left: 12,
            bottom: 168,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: h.type == 'accident' ? Colors.red : Colors.orange,
                borderRadius: BorderRadius.circular(12),
                boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 8)],
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(
                  h.type == 'accident'
                      ? Icons.warning
                      : h.type == 'construction'
                          ? Icons.construction
                          : h.type == 'slowTraffic'
                              ? Icons.traffic
                              : Icons.warning_amber,
                  color: Colors.white,
                  size: 18,
                ),
                const SizedBox(width: 6),
                Text('${_round(d)}m ${h.type}',
                    style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
              ]),
            ),
          ),
        );
      }
    }
    return warnings;
  }

  Widget _turnPreviewPanel() {
    final upcoming = _getUpcomingManeuvers(4);
    if (upcoming.isEmpty) return const SizedBox.shrink();

    return Positioned(
      left: 10,
      right: 10,
      bottom: 100,
      child: ScaleTransition(
        scale: _turnPreviewAnim,
        child: Material(
          color: _panel,
          borderRadius: BorderRadius.circular(14),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('${_t('nextTurns')} (${upcoming.length})',
                    style: const TextStyle(color: Colors.white54, fontSize: 11, fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                ...upcoming.map((man) {
                  final d = _distanceToManeuver(upcoming.indexOf(man) + _nextMan);
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(children: [
                      Icon(_iconFor(man.key), color: _go, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${_round(d)}m · ${man.name.isNotEmpty ? man.name : _man(man.key)}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
                            if (upcoming.indexOf(man) < upcoming.length - 1)
                              Text('then ${_man(upcoming[upcoming.indexOf(man) + 1].key)}',
                                  style: const TextStyle(color: Colors.white54, fontSize: 10)),
                          ],
                        ),
                      ),
                    ]),
                  );
                }).toList(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _speedProfileChart() {
    final r = _route;
    if (r == null || r.limits.isEmpty) return const SizedBox.shrink();

    return Positioned(
      top: 120,
      left: 10,
      right: 10,
      height: 60,
      child: Material(
        color: _panelLight.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Row(
            children: [
              const Icon(Icons.speed, color: _go, size: 18),
              const SizedBox(width: 6),
              Expanded(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      for (var i = 0; i < r.limits.length; i += 5)
                        Padding(
                          padding: const EdgeInsets.only(right: 4),
                          child: Container(
                            width: 20,
                            height: 40,
                            decoration: BoxDecoration(
                              color: (r.limits[i] ?? 0) > 100
                                  ? Colors.green
                                  : (r.limits[i] ?? 0) > 50
                                      ? _go
                                      : _warn,
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _navInfoBar() {
    final r = _route;
    if (r == null || _pos == null) return const SizedBox.shrink();

    final remaining = _remainingMeters(_pos!);
    final min = (remaining / 1000 / 50 * 60).clamp(0, 999).round();
    final distTraveled = _cum[_nearestIndex(_pos!)];
    final totalDist = r.distance;

    return Container(
      color: _panel.withValues(alpha: 0.95),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$min ${_t('minRemaining')}',
                    style: const TextStyle(color: _go, fontSize: 14, fontWeight: FontWeight.w800)),
                Text('${_fmtKm(remaining)} remaining',
                    style: const TextStyle(color: Colors.white54, fontSize: 11)),
              ],
            ),
            const Spacer(),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Text('${_speedKmh.round()} / ${_currentSpeedLimit() ?? '?'} km/h',
                      style: TextStyle(
                          color: _speedKmh > (_currentSpeedLimit() ?? 200) ? _warn : Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w700)),
                  LinearProgressIndicator(
                    value: (_speedKmh / (_currentSpeedLimit() ?? 120)).clamp(0, 1),
                    minHeight: 2,
                    backgroundColor: Colors.white12,
                    valueColor: AlwaysStoppedAnimation<Color>(
                        _speedKmh > (_currentSpeedLimit() ?? 120) ? _warn : _go),
                  ),
                ],
              ),
            ),
            const Spacer(),
            Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('${(distTraveled / totalDist * 100).toStringAsFixed(0)}%',
                    style: const TextStyle(color: _go, fontSize: 14, fontWeight: FontWeight.w800)),
                Text('${_fmtKm(distTraveled)} / ${_fmtKm(totalDist)}',
                    style: const TextStyle(color: Colors.white54, fontSize: 11)),
              ],
            ),
          ],
        ),
      ),
    );
  }

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

  // Search + Menu button
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
      if (_suggest.isEmpty && _search.text.isEmpty) ...[
        const SizedBox(height: 10),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            if (_home != null)
              _shortcutBtn(Icons.home, 'Zuhause', () => _routeToLocation(_home!, label: 'Zuhause')),
            if (_work != null)
              _shortcutBtn(Icons.work, 'Arbeit', () => _routeToLocation(_work!, label: 'Arbeit')),
            for (final recent in _recentSearches.take(3))
              _shortcutBtn(Icons.history, recent, () => _routeToLocation(LatLng(0, 0), label: recent)),
          ]),
        ),
      ],
      for (final s in _suggest)
        Material(
          color: _panelLight,
          child: ListTile(
            dense: true,
            leading: const Icon(Icons.location_on, color: Colors.white54, size: 18),
            title: Text(s['display_name'] as String,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white, fontSize: 13)),
            onTap: () {
              final name = (s['display_name'] as String).split(',').first;
              _search.text = name;
              setState(() => _suggest = []);
              _computeRoute(
                  LatLng(double.parse(s['lat'] as String), double.parse(s['lon'] as String)),
                  query: name);
            },
          ),
        ),
    ]);
  }

  Widget _shortcutBtn(IconData icon, String label, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Material(
        color: _panelLight,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(icon, color: _go, size: 20),
              const SizedBox(height: 4),
              Text(label, style: const TextStyle(color: Colors.white, fontSize: 11)),
            ]),
          ),
        ),
      ),
    );
  }

  // Navigation instruction + lanes + progress bar
  Widget _navTop() {
    final r = _route!;
    final man = (r.maneuvers.isNotEmpty && _nextMan < r.maneuvers.length)
        ? r.maneuvers[_nextMan]
        : null;
    final d = (man != null && _pos != null)
        ? _distance.as(LengthUnit.Meter, _pos!, man.location)
        : 0.0;
    return Column(children: [
      // Progress bar
      if (_pos != null)
        ClipRRect(
          borderRadius: BorderRadius.circular(3),
          child: LinearProgressIndicator(
            value: _routeProgress(_pos!),
            minHeight: 3,
            backgroundColor: Colors.white12,
            valueColor: const AlwaysStoppedAnimation<Color>(_go),
          ),
        ),
      const SizedBox(height: 8),
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
                          color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800)),
                  Text(
                      man == null || man.name.isEmpty
                          ? _man(man?.key ?? 'straight')
                          : '${_man(man.key)} · ${man.name}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w600)),
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
              onLongPress: () => _showRouteDetails(i),
              child: Container(
                margin: const EdgeInsets.only(right: 8),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: _panel,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: i == _sel ? _go : Colors.white24, width: 2),
                  boxShadow: i == _sel
                      ? [BoxShadow(color: _go.withValues(alpha: 0.3), blurRadius: 8)]
                      : [],
                ),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text('${(_alts[i].duration / 60).round()} ${_t('min')}',
                      style: TextStyle(
                          color: i == _sel ? _go : Colors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: 16)),
                  Text(_fmtKm(_alts[i].distance),
                      style: const TextStyle(color: Colors.white54, fontSize: 12)),
                  if (i == _sel)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Container(
                        width: 4,
                        height: 4,
                        decoration: BoxDecoration(color: _go, shape: BoxShape.circle),
                      ),
                    ),
                ]),
              ),
            ),
        ]),
      ),
    );
  }

  void _showRouteDetails(int routeIndex) {
    final route = _alts[routeIndex];
    final tollEstimate = _estimateTolls(route);
    final fuelEstimate = _estimateFuel(route);
    final parkingDifficulty = _estimateParkingDifficulty(route.points.last);

    showModalBottomSheet(
      context: context,
      backgroundColor: _panel,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => Directionality(
        textDirection: _rtl ? TextDirection.rtl : TextDirection.ltr,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text('${_t('routeDetails')} #${routeIndex + 1}',
                style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 16),
            _detailRow('Time', '${(route.duration / 60).round()} minutes', _go),
            _detailRow('Distance', _fmtKm(route.distance), Colors.white),
            _detailRow('Tolls', tollEstimate > 0 ? '~${tollEstimate.toStringAsFixed(0)} SAR' : 'None', _warn),
            _detailRow('Fuel', '~${fuelEstimate.toStringAsFixed(1)}L', Colors.orange),
            _detailRow('Parking', parkingDifficulty, Colors.blue),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: _go),
                onPressed: () {
                  Navigator.pop(context);
                  _selectAlt(routeIndex);
                },
                child: Text(_t('selectRoute'),
                    style: const TextStyle(color: Colors.black, fontWeight: FontWeight.w700)),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _detailRow(String label, String value, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(children: [
        Text(label, style: const TextStyle(color: Colors.white54, fontSize: 13)),
        const Spacer(),
        Text(value,
            style: TextStyle(color: color, fontSize: 14, fontWeight: FontWeight.w700)),
      ]),
    );
  }

  double _estimateTolls(RouteResult route) {
    // Simulated toll estimation based on route distance
    // In Saudi Arabia, tolls are ~0.5 SAR per km on saher highways
    if (route.distance > 50000) return (route.distance / 1000) * 0.5;
    return 0;
  }

  double _estimateFuel(RouteResult route) {
    // Estimate fuel consumption: ~7L per 100km
    return (route.distance / 1000) * 0.07;
  }

  String _estimateParkingDifficulty(LatLng location) {
    // Simulate parking difficulty based on location
    // In real app, would use OSM data or parking APIs
    final hash = location.latitude.toString().hashCode + location.longitude.toString().hashCode;
    if (hash % 5 == 0) return 'Easy';
    if (hash % 5 == 1) return 'Moderate';
    if (hash % 5 == 2) return 'Difficult';
    return 'Unknown';
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

  String _formatETA() {
    final rem = _pos != null ? _remainingMeters(_pos!) : 0.0;
    final minRemain = (rem / 1000 / 50 * 60).clamp(0, 999).round();
    final now = DateTime.now();
    final arrival = now.add(Duration(minutes: minRemain));
    return '${arrival.hour.toString().padLeft(2, '0')}:${arrival.minute.toString().padLeft(2, '0')}';
  }

  Widget _bottomBar() {
    final rem = _pos != null ? _remainingMeters(_pos!) : 0.0;
    final min = (rem / 1000 / 50 * 60).clamp(0, 999).round();
    final over = _speedKmh > 121;
    return Row(children: [
      Container(
        width: 72,
        height: 72,
        decoration: BoxDecoration(
          color: _panel,
          shape: BoxShape.circle,
          border: Border.all(color: over ? _warn : _go, width: 3),
          boxShadow: [
            BoxShadow(
              color: (over ? _warn : _go).withValues(alpha: 0.2),
              blurRadius: 12,
            ),
          ],
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
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: _panel,
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.3),
                blurRadius: 8,
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_navigating)
                Text(_formatETA(),
                    style: const TextStyle(
                        color: Colors.white, fontSize: 18, fontWeight: FontWeight.w900))
              else
                Text(_fmtKm(_route!.distance),
                    style: const TextStyle(
                        color: Colors.white, fontSize: 18, fontWeight: FontWeight.w900)),
              const SizedBox(height: 2),
              Text(_navigating ? '$min min' : _fmtKm(rem),
                  style: const TextStyle(color: Colors.white54, fontSize: 12)),
            ],
          ),
        ),
      const Spacer(),
      FloatingActionButton(
        backgroundColor: _navigating ? _warn : _go,
        elevation: 6,
        onPressed: _route == null ? null : _startStop,
        child: Icon(_navigating ? Icons.close : Icons.navigation, color: Colors.black, size: 28),
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
      backgroundColor: _panel,
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
              child: SingleChildScrollView(
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
                  const SizedBox(height: 16),
                  _toggle(_t('voice'), _voice, (v) {
                    set(() => _voice = v);
                    _savePref('voice', v);
                  }),
                  _toggle(_t('lanes'), _showLanes, (v) {
                    set(() => _showLanes = v);
                    _savePref('show_lanes', v);
                  }),
                  _toggle(_t('cams'), _showCams, (v) {
                    set(() => _showCams = v);
                    _savePref('show_cams', v);
                  }),
                  _toggle(_t('miles'), _miles, (v) {
                    set(() => _miles = v);
                    _savePref('miles', v);
                  }),
                  const SizedBox(height: 16),
                  Text(_t('quickAccess'), style: const TextStyle(color: Colors.white54, fontSize: 13)),
                  const SizedBox(height: 8),
                  Row(children: [
                    Expanded(
                      child: _menuBtn(_t('setHome'), Icons.home, () {
                        if (_pos != null) {
                          _home = _pos;
                          _prefs.setDouble('home_lat', _pos!.latitude);
                          _prefs.setDouble('home_lon', _pos!.longitude);
                          set(() {});
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(_t('homeSaved')),
                              backgroundColor: _go,
                              duration: const Duration(seconds: 2),
                            ),
                          );
                        }
                      }),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _menuBtn(_t('setWork'), Icons.work, () {
                        if (_pos != null) {
                          _work = _pos;
                          _prefs.setDouble('work_lat', _pos!.latitude);
                          _prefs.setDouble('work_lon', _pos!.longitude);
                          set(() {});
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(_t('workSaved')),
                              backgroundColor: _go,
                              duration: const Duration(seconds: 2),
                            ),
                          );
                        }
                      }),
                    ),
                  ]),
                ]),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _menuBtn(String label, IconData icon, VoidCallback onTap) {
    return Material(
      color: _panelLight,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, color: _go, size: 20),
            const SizedBox(height: 6),
            Text(label, style: const TextStyle(color: Colors.white70, fontSize: 11)),
          ]),
        ),
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
          _savePref('language', code);
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
      'offRoute': 'Außerhalb der Route, neue Route wird berechnet',
      'enableLocation': 'Bitte Standortdienste aktivieren',
      'needPermission': 'Standort-Berechtigung nötig',
      'quickAccess': 'Schnellzugriff',
      'setHome': 'Zuhause speichern',
      'setWork': 'Arbeit speichern',
      'homeSaved': 'Zuhause gespeichert',
      'workSaved': 'Arbeit gespeichert',
      'prepareFor': 'Vorbereitung auf',
      'then': 'dann',
      'nextTurns': 'Nächste Abbiegungen',
      'minRemaining': 'Min',
      'destination': 'Ziel',
      'stopped': 'Route beendet',
      'routeDetails': 'Routendetails',
      'selectRoute': 'Route auswählen',
      'fuel': 'Kraftstoff',
      'tolls': 'Mautgebühren',
      'parking': 'Parken',
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
      'offRoute': 'Off route, recalculating …',
      'enableLocation': 'Please enable location services',
      'needPermission': 'Location permission needed',
      'quickAccess': 'Quick access',
      'setHome': 'Save home',
      'setWork': 'Save work',
      'homeSaved': 'Home saved',
      'workSaved': 'Work saved',
      'prepareFor': 'Prepare for',
      'then': 'then',
      'nextTurns': 'Next turns',
      'minRemaining': 'min',
      'destination': 'destination',
      'stopped': 'Route stopped',
      'routeDetails': 'Route details',
      'selectRoute': 'Select route',
      'fuel': 'Fuel',
      'tolls': 'Tolls',
      'parking': 'Parking',
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
      'offRoute': 'خارج المسار، يتم إعادة حساب …',
      'enableLocation': 'يرجى تفعيل خدمات الموقع',
      'needPermission': 'مطلوب إذن الموقع',
      'quickAccess': 'وصول سريع',
      'setHome': 'حفظ المنزل',
      'setWork': 'حفظ العمل',
      'homeSaved': 'تم حفظ المنزل',
      'workSaved': 'تم حفظ العمل',
      'prepareFor': 'استعد ل',
      'then': 'ثم',
      'nextTurns': 'الانعطافات التالية',
      'minRemaining': 'دقيقة',
      'destination': 'الوجهة',
      'stopped': 'توقفت المسار',
      'routeDetails': 'تفاصيل المسار',
      'selectRoute': 'اختر المسار',
      'fuel': 'الوقود',
      'tolls': 'الرسوم',
      'parking': 'مواقف السيارات',
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
