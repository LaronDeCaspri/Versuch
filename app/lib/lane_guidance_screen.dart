import 'dart:async';
import 'package:flutter/material.dart';
import 'route_data.dart';
import 'painters.dart';

/// Der Fahrspur-Bildschirm – Kernfunktion von Masar.
///
/// Läuft heute mit Demo-Daten (`demoRoute`). Sobald das HERE SDK angebunden ist,
/// füttern die Navigations-Events denselben Zustand (Entfernung, Spuren, Blitzer).
class LaneGuidanceScreen extends StatefulWidget {
  const LaneGuidanceScreen({super.key});

  @override
  State<LaneGuidanceScreen> createState() => _LaneGuidanceScreenState();
}

class _LaneGuidanceScreenState extends State<LaneGuidanceScreen> {
  Timer? _timer;
  int _index = 0;
  double _dist = demoRoute[0].startDistance;
  double _speed = 104;
  bool _running = false;
  bool _day = false;
  String _lang = 'de';

  Maneuver get _m => demoRoute[_index];
  NaviPalette get _p => _day ? NaviPalette.day : NaviPalette.night;
  bool get _rtl => _lang == 'ar';

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _toggleRun() {
    setState(() => _running = !_running);
    _timer?.cancel();
    if (_running) {
      _timer = Timer.periodic(const Duration(milliseconds: 50), _tick);
    }
  }

  void _tick(Timer t) {
    const dt = 0.05, scale = 4.2;
    setState(() {
      _dist -= (_speed / 3.6) * dt * scale;
      if (_dist <= 0) {
        _index = (_index + 1) % demoRoute.length;
        _dist = _m.startDistance;
      }
      // Tempo reagiert leicht aufs Limit / die Nähe zum Manöver.
      _speed = (_m.limit + (_dist < 300 ? -8 : 4)).toDouble();
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = _p;
    return Directionality(
      textDirection: _rtl ? TextDirection.rtl : TextDirection.ltr,
      child: Scaffold(
        body: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [p.skyTop, p.skyBot],
            ),
          ),
          child: SafeArea(
            child: Column(
              children: [
                _banner(p),
                _countBar(p),
                if (_showCamera) _cameraChip(p),
                Expanded(child: _road(p)),
                _lanes(p),
                _dash(p),
                _controls(p),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // --- Manöver-Banner oben ---
  Widget _banner(NaviPalette p) {
    return Container(
      color: p.panel,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Row(
        children: [
          Container(
            width: 58,
            height: 58,
            decoration: BoxDecoration(
              color: p.go.withOpacity(0.14),
              borderRadius: BorderRadius.circular(16),
            ),
            child: CustomPaint(
              painter: LaneArrowPainter(
                type: _maneuverToArrow(_m.type),
                active: true,
                color: p.go,
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      '${(_dist / 10).round() * 10}',
                      style: TextStyle(
                        color: p.ink,
                        fontSize: 34,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.5,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      Strings.of('unit_m', _lang),
                      style: TextStyle(
                          color: p.muted, fontSize: 16, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  _m.road[_lang] ?? '',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      color: p.ink, fontSize: 15, fontWeight: FontWeight.w600),
                ),
                Text(
                  _m.sub[_lang] ?? '',
                  style: TextStyle(
                      color: p.muted,
                      fontSize: 12.5,
                      letterSpacing: 0.6,
                      fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _countBar(NaviPalette p) {
    final double pct = (1 - _dist / _m.startDistance).clamp(0.0, 1.0).toDouble();
    return Container(
      height: 5,
      color: Colors.white.withOpacity(0.08),
      alignment: _rtl ? Alignment.centerRight : Alignment.centerLeft,
      child: FractionallySizedBox(
        widthFactor: pct,
        child: Container(
          decoration: BoxDecoration(
            color: p.go,
            boxShadow: [BoxShadow(color: p.go.withOpacity(0.6), blurRadius: 10)],
          ),
        ),
      ),
    );
  }

  bool get _showCamera {
    final cam = _m.cameraAt;
    if (cam == null) return false;
    return cam > 0 ? (_dist > cam && _dist < cam + 650) : _dist < 650;
  }

  double get _cameraDistance {
    final cam = _m.cameraAt ?? 0;
    final d = cam > 0 ? _dist - cam : _dist;
    return d < 0 ? 0 : d;
  }

  Widget _cameraChip(NaviPalette p) {
    return Container(
      margin: const EdgeInsets.fromLTRB(14, 12, 14, 0),
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
      decoration: BoxDecoration(
        color: p.warn.withOpacity(0.16),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: p.warn.withOpacity(0.4)),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
                color: p.warn, borderRadius: BorderRadius.circular(9)),
            child: const Icon(Icons.speed, color: Colors.white, size: 20),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(Strings.of('camera', _lang),
                    style: TextStyle(
                        color: p.ink, fontSize: 14, fontWeight: FontWeight.w700)),
                Text(Strings.limitText(_m.limit, _lang),
                    style: TextStyle(color: p.muted, fontSize: 12)),
              ],
            ),
          ),
          Text('${(_cameraDistance / 10).round() * 10}',
              style: TextStyle(
                  color: p.warn,
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  fontFeatures: const [FontFeature.tabularFigures()])),
        ],
      ),
    );
  }

  Widget _road(NaviPalette p) {
    final double progress = (1 - _dist / _m.startDistance).clamp(0.0, 1.0).toDouble();
    return Stack(
      children: [
        Positioned.fill(
          child: CustomPaint(
            painter: RoadPainter(maneuver: _m, progress: progress, p: p),
          ),
        ),
        if (_m.exit != null)
          Positioned(
            top: 14,
            right: 16,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
              decoration: BoxDecoration(
                color: const Color(0xFF1D7A3F),
                borderRadius: BorderRadius.circular(9),
                border: Border.all(color: const Color(0xFFEAFFF2), width: 2),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('EXIT',
                      style: TextStyle(
                          color: Color(0xFFEAFFF2),
                          fontSize: 9,
                          letterSpacing: 1.2,
                          fontWeight: FontWeight.w700)),
                  Text(_m.exit!,
                      style: const TextStyle(
                          color: Color(0xFFEAFFF2),
                          fontSize: 19,
                          fontWeight: FontWeight.w800)),
                ],
              ),
            ),
          ),
      ],
    );
  }

  // --- Spur-Assistent (Kern) ---
  Widget _lanes(NaviPalette p) {
    return Container(
      color: p.panel,
      padding: const EdgeInsets.fromLTRB(12, 14, 12, 10),
      child: Column(
        children: [
          Text(
            Strings.of('lanes', _lang).toUpperCase(),
            style: TextStyle(
                color: p.muted,
                fontSize: 11,
                letterSpacing: 2,
                fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(_m.lanes.length, (i) {
              final on = _m.highlight.contains(i);
              return Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Container(
                  width: 60,
                  height: 68,
                  decoration: BoxDecoration(
                    color: on ? p.go.withOpacity(0.14) : p.dim.withOpacity(0.16),
                    borderRadius: BorderRadius.circular(12),
                    border: on ? Border.all(color: p.go, width: 1.5) : null,
                    boxShadow: on
                        ? [BoxShadow(color: p.go.withOpacity(0.5), blurRadius: 18)]
                        : null,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: CustomPaint(
                      painter: LaneArrowPainter(
                        type: _m.lanes[i],
                        active: on,
                        color: on ? p.go : p.dim,
                      ),
                    ),
                  ),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }

  // --- Untere Leiste: Tempo / Limit / ETA ---
  Widget _dash(NaviPalette p) {
    return Container(
      color: p.panel,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      child: Row(
        children: [
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('${_speed.round()}',
                  style: TextStyle(
                      color: p.ink,
                      fontSize: 32,
                      fontWeight: FontWeight.w800,
                      fontFeatures: const [FontFeature.tabularFigures()])),
              Text(Strings.of('kmh', _lang),
                  style: TextStyle(
                      color: p.muted, fontSize: 10.5, letterSpacing: 1)),
            ],
          ),
          const SizedBox(width: 14),
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0xFFE2382F), width: 5),
            ),
            alignment: Alignment.center,
            child: Text('${_m.limit}',
                style: const TextStyle(
                    color: Color(0xFF111111),
                    fontSize: 19,
                    fontWeight: FontWeight.w800,
                    fontFeatures: [FontFeature.tabularFigures()])),
          ),
          const Spacer(),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('14:32',
                  style: TextStyle(
                      color: p.ink,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      fontFeatures: const [FontFeature.tabularFigures()])),
              const SizedBox(height: 3),
              Text('18 min · 24 km',
                  style: TextStyle(color: p.muted, fontSize: 12)),
            ],
          ),
        ],
      ),
    );
  }

  // --- Steuerung (Prototyp) ---
  Widget _controls(NaviPalette p) {
    return Container(
      color: p.panel,
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 14),
      child: Row(
        children: [
          Expanded(
            child: FilledButton.icon(
              onPressed: _toggleRun,
              icon: Icon(_running ? Icons.pause : Icons.play_arrow),
              label: Text(Strings.of(_running ? 'pause' : 'play', _lang)),
              style: FilledButton.styleFrom(
                backgroundColor: p.go,
                foregroundColor: const Color(0xFF04140D),
              ),
            ),
          ),
          const SizedBox(width: 8),
          _segLang(p),
          const SizedBox(width: 8),
          IconButton.filledTonal(
            onPressed: () => setState(() => _day = !_day),
            icon: Icon(_day ? Icons.dark_mode : Icons.light_mode),
          ),
        ],
      ),
    );
  }

  Widget _segLang(NaviPalette p) {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: Colors.white24),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: ['de', 'en', 'ar'].map((l) {
          final active = _lang == l;
          return GestureDetector(
            onTap: () => setState(() => _lang = l),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
              color: active ? p.go : Colors.transparent,
              child: Text(
                l.toUpperCase(),
                style: TextStyle(
                    color: active ? const Color(0xFF04140D) : p.muted,
                    fontWeight: FontWeight.w700,
                    fontSize: 13),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  LaneArrow _maneuverToArrow(ManeuverType t) {
    switch (t) {
      case ManeuverType.right:
        return LaneArrow.right;
      case ManeuverType.slightRight:
        return LaneArrow.slightRight;
      case ManeuverType.left:
        return LaneArrow.left;
      case ManeuverType.through:
        return LaneArrow.through;
    }
  }
}
