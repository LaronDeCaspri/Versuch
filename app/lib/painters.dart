import 'package:flutter/material.dart';
import 'route_data.dart';

/// Farbpalette für Tag / Nacht.
class NaviPalette {
  final Color skyTop, skyBot, panel, road, roadEdge, laneLine;
  final Color go, dim, warn, ink, muted;

  const NaviPalette({
    required this.skyTop,
    required this.skyBot,
    required this.panel,
    required this.road,
    required this.roadEdge,
    required this.laneLine,
    required this.go,
    required this.dim,
    required this.warn,
    required this.ink,
    required this.muted,
  });

  static const night = NaviPalette(
    skyTop: Color(0xFF0A1120),
    skyBot: Color(0xFF12203C),
    panel: Color(0xFF0F1830),
    road: Color(0xFF17213D),
    roadEdge: Color(0xFF2A3A5E),
    laneLine: Color(0xFF3A4D76),
    go: Color(0xFF25E39A),
    dim: Color(0xFF586A8D),
    warn: Color(0xFFFF4D5E),
    ink: Color(0xFFEAF1FF),
    muted: Color(0xFF93A3C2),
  );

  static const day = NaviPalette(
    skyTop: Color(0xFFCFE0F4),
    skyBot: Color(0xFFA9C4E6),
    panel: Color(0xFFFFFFFF),
    road: Color(0xFFC3CEE0),
    roadEdge: Color(0xFF9FB0CC),
    laneLine: Color(0xFFFFFFFF),
    go: Color(0xFF12A56D),
    dim: Color(0xFF7C8AA6),
    warn: Color(0xFFE23A48),
    ink: Color(0xFF12203C),
    muted: Color(0xFF5A6B8A),
  );
}

/// Perspektivische Straße mit leuchtender Führungslinie auf die richtige Spur.
class RoadPainter extends CustomPainter {
  final Maneuver maneuver;
  final double progress; // 0..1, wie nah am Manöver
  final NaviPalette p;

  RoadPainter({required this.maneuver, required this.progress, required this.p});

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final cx = w / 2;
    final hy = h * 0.06; // Horizont-Höhe
    final baseHalf = w * 0.42;
    final topHalf = w * 0.03;

    // Straßenfläche
    final roadPath = Path()
      ..moveTo(cx - baseHalf, h)
      ..lineTo(cx - topHalf, hy)
      ..lineTo(cx + topHalf, hy)
      ..lineTo(cx + baseHalf, h)
      ..close();
    canvas.drawPath(roadPath, Paint()..color = p.road);

    // Ränder
    final edge = Paint()
      ..color = p.roadEdge
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke;
    canvas.drawLine(Offset(cx - baseHalf, h), Offset(cx - topHalf, hy), edge);
    canvas.drawLine(Offset(cx + baseHalf, h), Offset(cx + topHalf, hy), edge);

    // Gestrichelte Spur-Trennlinien
    final n = maneuver.lanes.length;
    final line = Paint()
      ..color = p.laneLine
      ..strokeWidth = 2.5
      ..style = PaintingStyle.stroke;
    for (var i = 1; i < n; i++) {
      final f = i / n;
      final bx = (cx - baseHalf) + f * baseHalf * 2;
      final tx = (cx - topHalf) + f * topHalf * 2;
      _dashedLine(canvas, Offset(bx, h), Offset(tx, hy), line);
    }

    // Leuchtende Führungslinie über den markierten Spuren
    final gf = (maneuver.highlightCenter + 0.5) / n;
    final gbx = (cx - baseHalf) + gf * baseHalf * 2;
    final gtx = (cx - topHalf) + gf * topHalf * 2;
    final double near = progress.clamp(0.0, 1.0).toDouble();

    final guide = Paint()
      ..color = p.go
      ..strokeWidth = (baseHalf * 2 / n * 0.5).clamp(10, 40).toDouble()
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6);

    final path = Path()..moveTo(gbx, h);
    switch (maneuver.type) {
      case ManeuverType.right:
        path.quadraticBezierTo(
            gbx + w * 0.16 * near, h * 0.5, gtx + w * 0.12 * near, hy + h * 0.14);
        break;
      case ManeuverType.slightRight:
        path.quadraticBezierTo(
            gbx + w * 0.10 * near, h * 0.5, gtx + w * 0.05 * near, hy + h * 0.05);
        break;
      case ManeuverType.left:
        path.quadraticBezierTo(
            gbx - w * 0.16 * near, h * 0.5, gtx - w * 0.1 * near, hy + h * 0.1);
        break;
      case ManeuverType.through:
        path.lineTo(gtx, hy);
        break;
    }
    canvas.drawPath(path, guide);
  }

  void _dashedLine(Canvas canvas, Offset a, Offset b, Paint paint) {
    const dash = 16.0, gap = 16.0;
    final total = (b - a).distance;
    final dir = (b - a) / total;
    var d = 0.0;
    while (d < total) {
      final start = a + dir * d;
      final end = a + dir * (d + dash).clamp(0.0, total).toDouble();
      canvas.drawLine(start, end, paint);
      d += dash + gap;
    }
  }

  @override
  bool shouldRepaint(covariant RoadPainter old) =>
      old.progress != progress || old.maneuver != maneuver || old.p != p;
}

/// Ein Spur-Pfeil (durch / rechts / leicht rechts / links).
class LaneArrowPainter extends CustomPainter {
  final LaneArrow type;
  final bool active;
  final Color color;

  LaneArrowPainter({required this.type, required this.active, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final paint = Paint()
      ..color = color
      ..strokeWidth = w * 0.12
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;

    final path = Path();
    final head = Path();

    switch (type) {
      case LaneArrow.through:
        path
          ..moveTo(w * 0.5, h * 0.9)
          ..lineTo(w * 0.5, h * 0.2);
        head
          ..moveTo(w * 0.32, h * 0.38)
          ..lineTo(w * 0.5, h * 0.18)
          ..lineTo(w * 0.68, h * 0.38);
        break;
      case LaneArrow.right:
        path
          ..moveTo(w * 0.3, h * 0.9)
          ..lineTo(w * 0.3, h * 0.5)
          ..quadraticBezierTo(w * 0.3, h * 0.28, w * 0.6, h * 0.28)
          ..lineTo(w * 0.78, h * 0.28);
        head
          ..moveTo(w * 0.64, h * 0.14)
          ..lineTo(w * 0.86, h * 0.28)
          ..lineTo(w * 0.64, h * 0.42);
        break;
      case LaneArrow.slightRight:
        path
          ..moveTo(w * 0.38, h * 0.9)
          ..lineTo(w * 0.38, h * 0.5)
          ..quadraticBezierTo(w * 0.38, h * 0.32, w * 0.7, h * 0.2);
        head
          ..moveTo(w * 0.52, h * 0.14)
          ..lineTo(w * 0.8, h * 0.16)
          ..lineTo(w * 0.66, h * 0.4);
        break;
      case LaneArrow.left:
        path
          ..moveTo(w * 0.7, h * 0.9)
          ..lineTo(w * 0.7, h * 0.5)
          ..quadraticBezierTo(w * 0.7, h * 0.28, w * 0.4, h * 0.28)
          ..lineTo(w * 0.22, h * 0.28);
        head
          ..moveTo(w * 0.36, h * 0.14)
          ..lineTo(w * 0.14, h * 0.28)
          ..lineTo(w * 0.36, h * 0.42);
        break;
    }
    canvas.drawPath(path, paint);
    canvas.drawPath(head, paint);
  }

  @override
  bool shouldRepaint(covariant LaneArrowPainter old) =>
      old.active != active || old.color != color || old.type != type;
}
